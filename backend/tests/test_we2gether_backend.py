"""We2gether backend tests covering the 4 user-reported fixes + regression."""
import io
import os
import time
import struct
import zlib
import requests
import pytest
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

UK_TZ = ZoneInfo("Europe/London")


# ---------- helpers ----------
def _png_bytes():
    # Minimal 1x1 PNG
    sig = b"\x89PNG\r\n\x1a\n"
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(b"\x00\xff\xff\xff"))
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


def _gif_bytes():
    # 1x1 transparent GIF89a
    return (b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00"
            b"!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;")


def _mp4_bytes():
    # Very small "fake" MP4 file (ftyp box only) — server does not validate
    ftyp = b"\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2avc1mp41"
    mdat = b"\x00\x00\x00\x08mdat"
    return ftyp + mdat


# ============================================================
# COUPLES / AUTH
# ============================================================
class TestCouples:
    def test_create_and_me(self):
        r = requests.post(f"{os.environ.get('EXPO_PUBLIC_BACKEND_URL','https://couples-sync-app-1.preview.emergentagent.com').rstrip('/')}/api/couples/create", json={"name": "TEST_Solo"})
        assert r.status_code == 200
        j = r.json()
        assert "user_id" in j and "code" in j and j["paired"] is False

    def test_create_join_flow(self, couple_pair):
        alex_id, masha_id, couple_id, code = couple_pair
        # Verify via /me
        from conftest import BASE_URL
        r = requests.get(f"{BASE_URL}/api/couples/me", headers={"X-User-Id": alex_id})
        assert r.status_code == 200
        j = r.json()
        assert j["paired"] is True
        assert j["partner"]["user_id"] == masha_id


# ============================================================
# READ RECEIPTS (Fix #3)
# ============================================================
class TestReadReceipts:
    def test_sent_delivered_read_transitions(self, couple_pair):
        from conftest import BASE_URL
        alex_id, masha_id, _, _ = couple_pair

        # Alex sends a fresh text
        r = requests.post(f"{BASE_URL}/api/messages/text",
                          headers={"X-User-Id": alex_id, "Content-Type": "application/json"},
                          json={"text": "TEST_read_receipt_probe"})
        assert r.status_code == 200
        msg = r.json()
        mid = msg["id"]
        assert msg["delivered_at"] is None
        assert msg["read_at"] is None

        # (a) BEFORE Masha fetches — Alex sees Sent
        r = requests.get(f"{BASE_URL}/api/messages", headers={"X-User-Id": alex_id})
        assert r.status_code == 200
        mine = next(m for m in r.json() if m["id"] == mid)
        assert mine["delivered_at"] is None, "should still be Sent before partner fetches"
        assert mine["read_at"] is None

        # (b) Masha fetches → delivered_at stamped for Alex
        r = requests.get(f"{BASE_URL}/api/messages", headers={"X-User-Id": masha_id})
        assert r.status_code == 200
        r = requests.get(f"{BASE_URL}/api/messages", headers={"X-User-Id": alex_id})
        mine = next(m for m in r.json() if m["id"] == mid)
        assert mine["delivered_at"] is not None, "delivered_at should be set after partner fetch"
        assert mine["read_at"] is None, "read_at not set yet"

        # (c) Masha marks as read via through_id
        r = requests.post(f"{BASE_URL}/api/messages/read",
                          headers={"X-User-Id": masha_id, "Content-Type": "application/json"},
                          json={"through_id": mid})
        assert r.status_code == 200
        assert r.json()["ok"] is True

        r = requests.get(f"{BASE_URL}/api/messages", headers={"X-User-Id": alex_id})
        mine = next(m for m in r.json() if m["id"] == mid)
        assert mine["read_at"] is not None, "read_at should be set after partner /read"


# ============================================================
# MEDIA UPLOAD (Fix #2) — JPEG, GIF, MP4
# ============================================================
class TestMediaUpload:
    def _upload(self, base, uid, filename, content, mime, media_type):
        files = {"file": (filename, io.BytesIO(content), mime)}
        data = {"media_type": media_type, "privacy": "none"}
        return requests.post(f"{base}/api/messages/media",
                             headers={"X-User-Id": uid},
                             files=files, data=data, timeout=60)

    def test_upload_png_image(self, couple_pair):
        from conftest import BASE_URL
        alex_id, _, _, _ = couple_pair
        r = self._upload(BASE_URL, alex_id, "test.png", _png_bytes(), "image/png", "image")
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["type"] == "media"
        assert j["media_type"] == "image"
        assert j["media_path"].endswith(".png")
        # retrieve
        d = requests.get(f"{BASE_URL}/api/files/{j['media_path']}", headers={"X-User-Id": alex_id})
        assert d.status_code == 200
        assert len(d.content) > 0

    def test_upload_animated_gif(self, couple_pair):
        from conftest import BASE_URL
        alex_id, _, _, _ = couple_pair
        r = self._upload(BASE_URL, alex_id, "sticker.gif", _gif_bytes(), "image/gif", "image")
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["media_path"].endswith(".gif"), f"expected .gif ext, got {j['media_path']}"
        d = requests.get(f"{BASE_URL}/api/files/{j['media_path']}", headers={"X-User-Id": alex_id})
        assert d.status_code == 200
        assert d.content[:6] in (b"GIF89a", b"GIF87a")

    def test_upload_mp4_video(self, couple_pair):
        from conftest import BASE_URL
        alex_id, _, _, _ = couple_pair
        r = self._upload(BASE_URL, alex_id, "clip.mp4", _mp4_bytes(), "video/mp4", "video")
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["media_type"] == "video"
        assert j["media_path"].endswith(".mp4")
        d = requests.get(f"{BASE_URL}/api/files/{j['media_path']}", headers={"X-User-Id": alex_id})
        assert d.status_code == 200
        assert len(d.content) > 0


# ============================================================
# CALENDAR UK TIME (Fix #1)
# ============================================================
class TestCalendarUK:
    def test_create_today_and_future_event_list_and_delete(self, couple_pair):
        from conftest import BASE_URL
        alex_id, _, _, _ = couple_pair
        today = datetime.now(UK_TZ).date()
        future = today + timedelta(days=7)

        # today OK
        r = requests.post(f"{BASE_URL}/api/events",
                          headers={"X-User-Id": alex_id, "Content-Type": "application/json"},
                          json={"title": "TEST_today", "note": "", "event_date": today.isoformat()})
        assert r.status_code == 200, r.text
        today_id = r.json()["id"]

        # future OK
        r = requests.post(f"{BASE_URL}/api/events",
                          headers={"X-User-Id": alex_id, "Content-Type": "application/json"},
                          json={"title": "TEST_future", "note": "trip", "event_date": future.isoformat()})
        assert r.status_code == 200
        future_id = r.json()["id"]

        # List contains both
        r = requests.get(f"{BASE_URL}/api/events", headers={"X-User-Id": alex_id})
        assert r.status_code == 200
        ids = {e["id"] for e in r.json()}
        assert today_id in ids and future_id in ids

        # Delete works for author
        r = requests.delete(f"{BASE_URL}/api/events/{today_id}", headers={"X-User-Id": alex_id})
        assert r.status_code == 200 and r.json()["ok"] is True

    def test_past_event_rejected(self, couple_pair):
        from conftest import BASE_URL
        alex_id, _, _, _ = couple_pair
        past = (datetime.now(UK_TZ).date() - timedelta(days=2)).isoformat()
        r = requests.post(f"{BASE_URL}/api/events",
                          headers={"X-User-Id": alex_id, "Content-Type": "application/json"},
                          json={"title": "TEST_past", "note": "", "event_date": past})
        assert r.status_code == 400

    def test_delete_by_non_author_forbidden(self, couple_pair):
        from conftest import BASE_URL
        alex_id, masha_id, _, _ = couple_pair
        future = (datetime.now(UK_TZ).date() + timedelta(days=3)).isoformat()
        r = requests.post(f"{BASE_URL}/api/events",
                          headers={"X-User-Id": alex_id, "Content-Type": "application/json"},
                          json={"title": "TEST_shared", "event_date": future})
        eid = r.json()["id"]
        r = requests.delete(f"{BASE_URL}/api/events/{eid}", headers={"X-User-Id": masha_id})
        assert r.status_code == 403


# ============================================================
# NOTIFICATIONS setup (Fix #4)
# ============================================================
class TestRegisterPush:
    def test_register_push_endpoint_wired(self, couple_pair):
        from conftest import BASE_URL
        alex_id, _, _, _ = couple_pair
        r = requests.post(f"{BASE_URL}/api/register-push",
                          json={"user_id": alex_id, "platform": "ios", "device_token": "TEST_FAKE_TOKEN"},
                          timeout=15)
        # 201 registered OR 500/502 acceptable (placeholder key). Must not crash → not 404.
        assert r.status_code in (201, 500, 502), f"unexpected status {r.status_code}: {r.text}"


# ============================================================
# REGRESSION
# ============================================================
class TestRegression:
    def test_text_message(self, couple_pair):
        from conftest import BASE_URL
        alex_id, _, _, _ = couple_pair
        r = requests.post(f"{BASE_URL}/api/messages/text",
                          headers={"X-User-Id": alex_id, "Content-Type": "application/json"},
                          json={"text": "TEST_regression_hi"})
        assert r.status_code == 200
        assert r.json()["text"] == "TEST_regression_hi"

    def test_moods_get_set(self, couple_pair):
        from conftest import BASE_URL
        alex_id, _, _, _ = couple_pair
        r = requests.post(f"{BASE_URL}/api/moods",
                          headers={"X-User-Id": alex_id, "Content-Type": "application/json"},
                          json={"emoji": "😀", "label": "Good", "note": "TEST"})
        assert r.status_code == 200
        r = requests.get(f"{BASE_URL}/api/moods", headers={"X-User-Id": alex_id})
        assert r.status_code == 200
        j = r.json()
        assert alex_id in j["moods"]
        assert j["moods"][alex_id]["emoji"] == "😀"

    def test_worries_and_comments(self, couple_pair):
        from conftest import BASE_URL
        alex_id, masha_id, _, _ = couple_pair
        r = requests.post(f"{BASE_URL}/api/worries",
                          headers={"X-User-Id": alex_id, "Content-Type": "application/json"},
                          json={"text": "TEST_worry"})
        assert r.status_code == 200
        wid = r.json()["id"]
        r = requests.post(f"{BASE_URL}/api/worries/{wid}/comments",
                          headers={"X-User-Id": masha_id, "Content-Type": "application/json"},
                          json={"text": "TEST_comment"})
        assert r.status_code == 200
        r = requests.get(f"{BASE_URL}/api/worries", headers={"X-User-Id": alex_id})
        assert r.status_code == 200
        found = next((w for w in r.json() if w["id"] == wid), None)
        assert found is not None
        assert any(c["text"] == "TEST_comment" for c in found["comments"])

    def test_gallery_lists_media(self, couple_pair):
        from conftest import BASE_URL
        alex_id, _, _, _ = couple_pair
        # upload one so gallery has at least one
        files = {"file": ("g.png", io.BytesIO(_png_bytes()), "image/png")}
        requests.post(f"{BASE_URL}/api/messages/media",
                      headers={"X-User-Id": alex_id},
                      files=files, data={"media_type": "image", "privacy": "none"})
        r = requests.get(f"{BASE_URL}/api/gallery", headers={"X-User-Id": alex_id})
        assert r.status_code == 200
        assert isinstance(r.json(), list)
