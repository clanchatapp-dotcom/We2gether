"""Backend integration tests for 2gether app.

Covers couples create/join/me, messages, moods, worries+comments,
and register-push (which is expected to fail upstream in preview
but must NOT crash the server or block primary ops).
"""
import io
import os
import struct
import uuid
import zlib
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://calendar-read-harden.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _tiny_png_bytes() -> bytes:
    """Build a valid 1x1 red PNG in-memory (no PIL dependency)."""
    def _chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = _chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    raw = b"\x00\xff\x00\x00"  # filter byte + RGB(255,0,0)
    idat = _chunk(b"IDAT", zlib.compress(raw))
    iend = _chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


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


class TestMedia:
    """Regression: multipart photo upload flow after frontend api.ts + chat.tsx edits.

    Verifies:
      * POST /api/messages/media accepts a multipart image and returns a media message
      * GET  /api/messages includes the new media item for both users
      * GET  /api/gallery includes non-one-time media
      * GET  /api/files/{path} works with X-User-Id header AND with ?uid= query
      * Wrong user cannot fetch the file (401 no user, or 404 wrong couple)
    """

    def test_upload_image_and_fetch(self, couple_session):
        a, b = couple_session
        png = _tiny_png_bytes()
        files = {"file": ("photo.jpg", io.BytesIO(png), "image/jpeg")}
        data = {"media_type": "image", "privacy": "none"}
        r = requests.post(f"{API}/messages/media", files=files, data=data,
                          headers={"X-User-Id": a["user_id"]}, timeout=60)
        assert r.status_code == 200, r.text
        msg = r.json()
        assert msg["type"] == "media"
        assert msg["media_type"] == "image"
        assert msg["privacy"] == "none"
        assert msg["is_mine"] is True
        assert msg.get("media_path"), "media_path missing"
        path = msg["media_path"]

        # /messages must list it for the sender
        rl = requests.get(f"{API}/messages", headers={"X-User-Id": a["user_id"]}, timeout=15)
        assert rl.status_code == 200
        assert any(m["id"] == msg["id"] for m in rl.json())

        # /gallery must include it (privacy != one_time)
        rg = requests.get(f"{API}/gallery", headers={"X-User-Id": b["user_id"]}, timeout=15)
        assert rg.status_code == 200
        assert any(m["id"] == msg["id"] for m in rg.json())

        # GET file with X-User-Id header
        rf = requests.get(f"{API}/files/{path}", headers={"X-User-Id": b["user_id"]}, timeout=30)
        assert rf.status_code == 200, rf.text
        assert rf.content.startswith(b"\x89PNG"), "bytes did not round-trip"
        assert rf.headers.get("Content-Type", "").startswith("image/")

        # GET file with ?uid= query (used by web preview <Image>)
        rf2 = requests.get(f"{API}/files/{path}?uid={b['user_id']}", timeout=30)
        assert rf2.status_code == 200
        assert rf2.content == rf.content

        # No auth -> 401
        r_noauth = requests.get(f"{API}/files/{path}", timeout=15)
        assert r_noauth.status_code == 401

    def test_upload_one_time_privacy_flow(self, couple_session):
        a, b = couple_session
        files = {"file": ("secret.png", io.BytesIO(_tiny_png_bytes()), "image/png")}
        data = {"media_type": "image", "privacy": "one_time"}
        r = requests.post(f"{API}/messages/media", files=files, data=data,
                          headers={"X-User-Id": a["user_id"]}, timeout=60)
        assert r.status_code == 200, r.text
        msg = r.json()
        assert msg["privacy"] == "one_time"
        assert msg["one_time"] is True
        path = msg["media_path"]

        # Recipient cannot fetch file until they "open" it
        rf_before = requests.get(f"{API}/files/{path}",
                                 headers={"X-User-Id": b["user_id"]}, timeout=15)
        assert rf_before.status_code == 403

        # Sender cannot re-fetch a one-time file (410)
        rf_sender = requests.get(f"{API}/files/{path}",
                                 headers={"X-User-Id": a["user_id"]}, timeout=15)
        assert rf_sender.status_code == 410

        # Recipient opens it
        ro = requests.post(f"{API}/messages/{msg['id']}/open", json={},
                           headers={"X-User-Id": b["user_id"]}, timeout=15)
        assert ro.status_code == 200

        # Now recipient can fetch bytes
        rf_after = requests.get(f"{API}/files/{path}",
                                headers={"X-User-Id": b["user_id"]}, timeout=30)
        assert rf_after.status_code == 200

        # Second open attempt -> 410 Already viewed
        ro2 = requests.post(f"{API}/messages/{msg['id']}/open", json={},
                            headers={"X-User-Id": b["user_id"]}, timeout=15)
        assert ro2.status_code == 410

        # One-time item should NOT be in /gallery
        rg = requests.get(f"{API}/gallery", headers={"X-User-Id": b["user_id"]}, timeout=15)
        assert rg.status_code == 200
        assert not any(m["id"] == msg["id"] for m in rg.json())

    def test_media_requires_auth(self):
        files = {"file": ("x.jpg", io.BytesIO(_tiny_png_bytes()), "image/jpeg")}
        r = requests.post(f"{API}/messages/media", files=files,
                          data={"media_type": "image", "privacy": "none"}, timeout=30)
        assert r.status_code == 401


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
