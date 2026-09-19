"""Unit test: put_object() self-heals when the cached storage_key goes stale.

The Emergent storage service can rotate/expire the storage_key mid-process,
which causes the PUT to return 401/403/503. The fix (server.py:57-73) mirrors
get_object(): reset the cached key, re-init, retry the PUT once.

This test monkeypatches server.requests so it never hits the network:
    1st PUT -> 503        (simulated stale key)
    /init  -> new key    (simulated re-init)
    2nd PUT -> 200        (retry succeeds)
Assertions:
  * put_object() returns the second PUT's JSON body (does not raise)
  * exactly ONE retry (2 PUTs total, 1 /init after the failure)
  * server.storage_key is reset to the new key
"""
import pytest

import server


class _FakeResp:
    def __init__(self, status_code: int, json_body=None, content: bytes = b""):
        self.status_code = status_code
        self._json = json_body if json_body is not None else {}
        self.content = content
        self.headers = {"Content-Type": "application/octet-stream"}

    def json(self):
        return self._json

    def raise_for_status(self):
        if self.status_code >= 400:
            raise AssertionError(f"raise_for_status called with {self.status_code}")


def test_put_object_selfheals_on_stale_key(monkeypatch):
    calls = {"put": 0, "post": 0}
    # Seed a stale cached key so init_storage returns it on the first call
    server.storage_key = "STALE_KEY"

    def fake_put(url, headers=None, data=None, timeout=None):
        calls["put"] += 1
        if calls["put"] == 1:
            # First attempt uses the stale key
            assert headers["X-Storage-Key"] == "STALE_KEY"
            return _FakeResp(503)
        # Second attempt uses the freshly-minted key
        assert headers["X-Storage-Key"] == "FRESH_KEY"
        return _FakeResp(200, json_body={"ok": True, "path": "p"})

    def fake_post(url, json=None, timeout=None):
        # /init is only called on the retry, since storage_key was pre-seeded
        calls["post"] += 1
        assert url.endswith("/init")
        return _FakeResp(200, json_body={"storage_key": "FRESH_KEY"})

    monkeypatch.setattr(server.requests, "put", fake_put)
    monkeypatch.setattr(server.requests, "post", fake_post)

    result = server.put_object("get2gether/uploads/u/x.jpg", b"bytes", "image/jpeg")

    assert result == {"ok": True, "path": "p"}
    assert calls["put"] == 2, "expected exactly one retry (2 PUTs total)"
    assert calls["post"] == 1, "expected exactly one /init after the failure"
    assert server.storage_key == "FRESH_KEY", "cached key must be rotated"


def test_put_object_no_retry_on_success(monkeypatch):
    """Sanity: happy path does NOT retry and does NOT re-init."""
    calls = {"put": 0, "post": 0}
    server.storage_key = "GOOD_KEY"

    def fake_put(url, headers=None, data=None, timeout=None):
        calls["put"] += 1
        assert headers["X-Storage-Key"] == "GOOD_KEY"
        return _FakeResp(200, json_body={"ok": True})

    def fake_post(url, json=None, timeout=None):
        calls["post"] += 1
        return _FakeResp(200, json_body={"storage_key": "SHOULD_NOT_BE_USED"})

    monkeypatch.setattr(server.requests, "put", fake_put)
    monkeypatch.setattr(server.requests, "post", fake_post)

    server.put_object("get2gether/uploads/u/x.jpg", b"bytes", "image/jpeg")

    assert calls["put"] == 1
    assert calls["post"] == 0
    assert server.storage_key == "GOOD_KEY"


@pytest.mark.parametrize("stale_status", [401, 403, 503])
def test_put_object_selfheals_on_all_stale_statuses(monkeypatch, stale_status):
    """The fix broadened the retry set to 401/403/503 — verify each."""
    calls = {"put": 0}
    server.storage_key = "STALE"

    def fake_put(url, headers=None, data=None, timeout=None):
        calls["put"] += 1
        if calls["put"] == 1:
            return _FakeResp(stale_status)
        return _FakeResp(200, json_body={"ok": True})

    def fake_post(url, json=None, timeout=None):
        return _FakeResp(200, json_body={"storage_key": "FRESH"})

    monkeypatch.setattr(server.requests, "put", fake_put)
    monkeypatch.setattr(server.requests, "post", fake_post)

    server.put_object("p", b"b", "image/jpeg")
    assert calls["put"] == 2
    assert server.storage_key == "FRESH"
