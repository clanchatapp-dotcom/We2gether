"""Backend integration tests for 2gether app.

Covers couples create/join/me, messages, moods, worries+comments,
and register-push (which is expected to fail upstream in preview
but must NOT crash the server or block primary ops).
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://mobile-push-notify.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def couple_session():
    """Create couple + join a partner. Returns (user_a, user_b, code, couple)."""
    r = requests.post(f"{API}/couples/create", json={"name": "TEST_Alex"}, timeout=30)
    assert r.status_code == 200, r.text
    a = r.json()
    assert "user_id" in a and "code" in a
    assert len(a["code"]) == 6
    assert a["paired"] is False

    r2 = requests.post(f"{API}/couples/join", json={"name": "TEST_Sam", "code": a["code"]}, timeout=30)
    assert r2.status_code == 200, r2.text
    b = r2.json()
    assert b["paired"] is True
    assert b["partner"]["name"] == "TEST_Alex"
    return a, b


class TestHealth:
    def test_root(self):
        r = requests.get(f"{API}/", timeout=15)
        assert r.status_code == 200
        assert r.json().get("message")


class TestCouples:
    def test_create_returns_code_and_userid(self):
        r = requests.post(f"{API}/couples/create", json={"name": "TEST_Solo"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert uuid.UUID(data["user_id"])
        assert len(data["code"]) == 6
        assert data["me"]["name"] == "TEST_Solo"
        assert data["partner"] is None
        assert data["paired"] is False

    def test_create_requires_name(self):
        r = requests.post(f"{API}/couples/create", json={"name": "   "}, timeout=15)
        assert r.status_code == 400

    def test_join_unknown_code_404(self):
        r = requests.post(f"{API}/couples/join", json={"name": "TEST_X", "code": "ZZZZZZ"}, timeout=15)
        assert r.status_code == 404

    def test_join_full_409(self, couple_session):
        a, _b = couple_session
        r = requests.post(f"{API}/couples/join", json={"name": "TEST_Third", "code": a["code"]}, timeout=15)
        assert r.status_code == 409

    def test_me_requires_header(self):
        r = requests.get(f"{API}/couples/me", timeout=15)
        assert r.status_code == 401

    def test_me_returns_state(self, couple_session):
        a, b = couple_session
        r = requests.get(f"{API}/couples/me", headers={"X-User-Id": a["user_id"]}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["paired"] is True
        assert d["me"]["name"] == "TEST_Alex"
        assert d["partner"]["name"] == "TEST_Sam"


class TestMessages:
    def test_send_text_and_list(self, couple_session):
        a, b = couple_session
        r = requests.post(f"{API}/messages/text", json={"text": "hello from TEST_Alex"},
                          headers={"X-User-Id": a["user_id"]}, timeout=15)
        # push relay may fail upstream but this MUST still succeed
        assert r.status_code == 200, r.text
        msg = r.json()
        assert msg["type"] == "text"
        assert msg["text"] == "hello from TEST_Alex"
        assert msg["is_mine"] is True

        # Partner lists it
        r2 = requests.get(f"{API}/messages", headers={"X-User-Id": b["user_id"]}, timeout=15)
        assert r2.status_code == 200
        texts = [m["text"] for m in r2.json() if m["type"] == "text"]
        assert "hello from TEST_Alex" in texts
        # For partner it should be is_mine=False
        for m in r2.json():
            if m.get("text") == "hello from TEST_Alex":
                assert m["is_mine"] is False

    def test_empty_text_rejected(self, couple_session):
        a, _b = couple_session
        r = requests.post(f"{API}/messages/text", json={"text": "   "},
                          headers={"X-User-Id": a["user_id"]}, timeout=15)
        assert r.status_code == 400


class TestMoods:
    def test_set_and_get_mood(self, couple_session):
        a, b = couple_session
        r = requests.post(f"{API}/moods",
                          json={"emoji": "😊", "label": "Happy", "note": "TEST_note"},
                          headers={"X-User-Id": a["user_id"]}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("ok") is True

        r2 = requests.get(f"{API}/moods", headers={"X-User-Id": b["user_id"]}, timeout=15)
        assert r2.status_code == 200
        data = r2.json()
        assert "date" in data and "moods" in data
        mine = data["moods"].get(a["user_id"])
        assert mine and mine["label"] == "Happy"
        assert mine["note"] == "TEST_note"


class TestWorries:
    def test_create_worry_and_comment(self, couple_session):
        a, b = couple_session
        r = requests.post(f"{API}/worries", json={"text": "TEST_worry about deadlines"},
                          headers={"X-User-Id": a["user_id"]}, timeout=15)
        assert r.status_code == 200, r.text
        wid = r.json()["id"]

        # partner comments
        rc = requests.post(f"{API}/worries/{wid}/comments",
                           json={"text": "TEST_you got this"},
                           headers={"X-User-Id": b["user_id"]}, timeout=15)
        assert rc.status_code == 200, rc.text

        # list
        rl = requests.get(f"{API}/worries", headers={"X-User-Id": a["user_id"]}, timeout=15)
        assert rl.status_code == 200
        wl = rl.json()
        w = next((x for x in wl if x["id"] == wid), None)
        assert w is not None
        assert w["is_mine"] is True
        assert len(w["comments"]) == 1
        assert w["comments"][0]["text"] == "TEST_you got this"
        assert w["comments"][0]["is_mine"] is False

    def test_empty_worry_rejected(self, couple_session):
        a, _b = couple_session
        r = requests.post(f"{API}/worries", json={"text": ""},
                          headers={"X-User-Id": a["user_id"]}, timeout=15)
        assert r.status_code == 400

    def test_comment_on_unknown_worry_404(self, couple_session):
        a, _b = couple_session
        r = requests.post(f"{API}/worries/{uuid.uuid4()}/comments",
                          json={"text": "hi"},
                          headers={"X-User-Id": a["user_id"]}, timeout=15)
        assert r.status_code == 404


class TestRegisterPush:
    def test_endpoint_exists_and_validates(self, couple_session):
        a, _b = couple_session
        # missing body -> 422
        r = requests.post(f"{API}/register-push", json={}, timeout=15)
        assert r.status_code == 422

        # valid body -> either 201 (unlikely in preview) or 500/502 due to placeholder key
        r2 = requests.post(f"{API}/register-push",
                           json={"user_id": a["user_id"], "platform": "android",
                                 "device_token": "TEST_devicetoken_abc"},
                           timeout=15)
        assert r2.status_code in (201, 500, 502), f"unexpected {r2.status_code}: {r2.text}"

    def test_server_still_alive_after_push_failure(self, couple_session):
        # after possibly-failing push, /api/ should still respond
        r = requests.get(f"{API}/", timeout=10)
        assert r.status_code == 200
