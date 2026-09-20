"""Backend integration tests for the shared calendar (/api/events) and
read receipts (/api/messages/read).

Mirrors the style of test_2gether_flows.py: HTTP integration against the
running backend, plus a couple of direct-DB assertions (via pymongo against
the same local MongoDB the server uses) for the self-healing expiry path,
since the API refuses to *create* an event in the past.
"""
import io
import os
import struct
import uuid
import zlib
from datetime import datetime, timedelta

import pytest
import requests
from zoneinfo import ZoneInfo

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://calendar-read-harden.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

UK_TZ = ZoneInfo("Europe/London")


def _uk_today() -> str:
    return datetime.now(UK_TZ).date().isoformat()


def _uk_date(days: int) -> str:
    return (datetime.now(UK_TZ).date() + timedelta(days=days)).isoformat()


def _tiny_png_bytes() -> bytes:
    def _chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = _chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    raw = b"\x00\xff\x00\x00"
    idat = _chunk(b"IDAT", zlib.compress(raw))
    iend = _chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


@pytest.fixture(scope="module")
def couple_session():
    """Create couple + join a partner. Returns (user_a, user_b)."""
    r = requests.post(f"{API}/couples/create", json={"name": "TEST_Eve"}, timeout=30)
    assert r.status_code == 200, r.text
    a = r.json()
    r2 = requests.post(f"{API}/couples/join", json={"name": "TEST_Max", "code": a["code"]}, timeout=30)
    assert r2.status_code == 200, r2.text
    b = r2.json()
    assert b["paired"] is True
    return a, b


def _db():
    """Direct pymongo handle to the same local MongoDB the server uses.

    Importing `server` runs its load_dotenv(), so MONGO_URL/DB_NAME land in
    os.environ even when pytest is invoked without the backend's env loaded.
    """
    import server  # noqa: F401  (triggers load_dotenv of backend/.env)
    from pymongo import MongoClient
    client = MongoClient(os.environ["MONGO_URL"])
    return client[os.environ["DB_NAME"]]


# ---------------------------------------------------------------------------
# Shared calendar / events
# ---------------------------------------------------------------------------
class TestEvents:
    def test_create_and_list_shows_author(self, couple_session):
        a, b = couple_session
        r = requests.post(
            f"{API}/events",
            json={"title": "TEST_Anniversary", "note": "dinner at 8", "event_date": _uk_date(10)},
            headers={"X-User-Id": a["user_id"]}, timeout=15,
        )
        assert r.status_code == 200, r.text
        e = r.json()
        assert uuid.UUID(e["id"])
        assert e["title"] == "TEST_Anniversary"
        assert e["note"] == "dinner at 8"
        assert e["author_name"] == "TEST_Eve"
        assert e["is_mine"] is True

        # Author lists it, is_mine True
        rl = requests.get(f"{API}/events", headers={"X-User-Id": a["user_id"]}, timeout=15)
        assert rl.status_code == 200
        mine = next((x for x in rl.json() if x["id"] == e["id"]), None)
        assert mine is not None
        assert mine["is_mine"] is True
        assert mine["author_name"] == "TEST_Eve"

        # Partner lists it, is_mine False, still sees the author name
        rp = requests.get(f"{API}/events", headers={"X-User-Id": b["user_id"]}, timeout=15)
        assert rp.status_code == 200
        theirs = next((x for x in rp.json() if x["id"] == e["id"]), None)
        assert theirs is not None
        assert theirs["is_mine"] is False
        assert theirs["author_name"] == "TEST_Eve"

    def test_create_today_is_allowed(self, couple_session):
        a, _b = couple_session
        r = requests.post(
            f"{API}/events",
            json={"title": "TEST_Today", "event_date": _uk_today()},
            headers={"X-User-Id": a["user_id"]}, timeout=15,
        )
        assert r.status_code == 200, r.text

    def test_create_requires_title(self, couple_session):
        a, _b = couple_session
        r = requests.post(
            f"{API}/events",
            json={"title": "   ", "event_date": _uk_date(3)},
            headers={"X-User-Id": a["user_id"]}, timeout=15,
        )
        assert r.status_code == 400

    def test_create_rejects_past_date(self, couple_session):
        a, _b = couple_session
        r = requests.post(
            f"{API}/events",
            json={"title": "TEST_Past", "event_date": _uk_date(-2)},
            headers={"X-User-Id": a["user_id"]}, timeout=15,
        )
        assert r.status_code == 400

    def test_create_rejects_bad_date_format(self, couple_session):
        a, _b = couple_session
        r = requests.post(
            f"{API}/events",
            json={"title": "TEST_Bad", "event_date": "27-01-2027"},
            headers={"X-User-Id": a["user_id"]}, timeout=15,
        )
        assert r.status_code == 400

    def test_requires_auth(self):
        r = requests.get(f"{API}/events", timeout=15)
        assert r.status_code == 401

    def test_expiry_filtering_and_self_heal_cleanup(self, couple_session):
        """An event whose date is before uk_today() must never be returned, and
        the first GET that touches it must soft-delete it (deleted_at set)."""
        a, _b = couple_session
        db = _db()
        past_id = str(uuid.uuid4())
        # Insert a past-dated event straight into Mongo (API refuses to create one).
        db.events.insert_one({
            "id": past_id,
            "couple_id": a["couple_id"],
            "author_id": a["user_id"],
            "author_name": "TEST_Eve",
            "title": "TEST_Expired",
            "note": "",
            "event_date": _uk_date(-1),
            "created_at": datetime.now().isoformat(),
            "deleted_at": None,
        })

        rl = requests.get(f"{API}/events", headers={"X-User-Id": a["user_id"]}, timeout=15)
        assert rl.status_code == 200
        assert not any(x["id"] == past_id for x in rl.json()), "expired event must be filtered out"

        # And it must be soft-deleted, not just hidden.
        doc = db.events.find_one({"id": past_id})
        assert doc is not None
        assert doc.get("deleted_at") is not None, "expired event must be soft-deleted on first touch"

    def test_author_only_delete(self, couple_session):
        a, b = couple_session
        r = requests.post(
            f"{API}/events",
            json={"title": "TEST_DeleteMe", "event_date": _uk_date(5)},
            headers={"X-User-Id": a["user_id"]}, timeout=15,
        )
        assert r.status_code == 200
        eid = r.json()["id"]

        # Partner cannot delete the author's event
        rp = requests.delete(f"{API}/events/{eid}", headers={"X-User-Id": b["user_id"]}, timeout=15)
        assert rp.status_code == 403

        # Author can
        ra = requests.delete(f"{API}/events/{eid}", headers={"X-User-Id": a["user_id"]}, timeout=15)
        assert ra.status_code == 200
        assert ra.json().get("ok") is True

        # Gone from the list
        rl = requests.get(f"{API}/events", headers={"X-User-Id": a["user_id"]}, timeout=15)
        assert not any(x["id"] == eid for x in rl.json())

    def test_delete_unknown_404(self, couple_session):
        a, _b = couple_session
        r = requests.delete(f"{API}/events/{uuid.uuid4()}", headers={"X-User-Id": a["user_id"]}, timeout=15)
        assert r.status_code == 404


# ---------------------------------------------------------------------------
# Read receipts
# ---------------------------------------------------------------------------
class TestMessagesRead:
    def test_read_through_id_marks_partner_messages(self, couple_session):
        a, b = couple_session
        # A sends two texts
        r1 = requests.post(f"{API}/messages/text", json={"text": "TEST_read_1"},
                           headers={"X-User-Id": a["user_id"]}, timeout=15)
        assert r1.status_code == 200
        m1 = r1.json()
        assert m1["read_at"] is None
        r2 = requests.post(f"{API}/messages/text", json={"text": "TEST_read_2"},
                           headers={"X-User-Id": a["user_id"]}, timeout=15)
        assert r2.status_code == 200
        m2 = r2.json()

        # B (recipient) marks read through the second message
        rr = requests.post(f"{API}/messages/read", json={"through_id": m2["id"]},
                           headers={"X-User-Id": b["user_id"]}, timeout=15)
        assert rr.status_code == 200, rr.text
        assert rr.json()["marked"] >= 2

        # A now sees both of their messages as read
        rl = requests.get(f"{API}/messages", headers={"X-User-Id": a["user_id"]}, timeout=15)
        by_id = {m["id"]: m for m in rl.json()}
        assert by_id[m1["id"]]["read_at"] is not None
        assert by_id[m2["id"]]["read_at"] is not None

    def test_read_does_not_mark_own_messages(self, couple_session):
        a, _b = couple_session
        r = requests.post(f"{API}/messages/text", json={"text": "TEST_own_unread"},
                          headers={"X-User-Id": a["user_id"]}, timeout=15)
        mid = r.json()["id"]
        # A calls read — must NOT mark A's own message
        rr = requests.post(f"{API}/messages/read", json={"through_id": mid},
                           headers={"X-User-Id": a["user_id"]}, timeout=15)
        assert rr.status_code == 200
        rl = requests.get(f"{API}/messages", headers={"X-User-Id": a["user_id"]}, timeout=15)
        mine = next(m for m in rl.json() if m["id"] == mid)
        assert mine["read_at"] is None, "sender's own message must not be marked read by the sender"

    def test_read_by_message_ids(self, couple_session):
        a, b = couple_session
        r = requests.post(f"{API}/messages/text", json={"text": "TEST_by_id"},
                          headers={"X-User-Id": a["user_id"]}, timeout=15)
        mid = r.json()["id"]
        rr = requests.post(f"{API}/messages/read", json={"message_ids": [mid]},
                           headers={"X-User-Id": b["user_id"]}, timeout=15)
        assert rr.status_code == 200
        assert rr.json()["marked"] == 1
        rl = requests.get(f"{API}/messages", headers={"X-User-Id": a["user_id"]}, timeout=15)
        marked = next(m for m in rl.json() if m["id"] == mid)
        assert marked["read_at"] is not None

    def test_read_through_unknown_404(self, couple_session):
        _a, b = couple_session
        r = requests.post(f"{API}/messages/read", json={"through_id": str(uuid.uuid4())},
                          headers={"X-User-Id": b["user_id"]}, timeout=15)
        assert r.status_code == 404

    def test_read_requires_auth(self):
        r = requests.post(f"{API}/messages/read", json={}, timeout=15)
        assert r.status_code == 401

    def test_read_is_independent_of_one_time_consumption(self, couple_session):
        """Marking a one-time item read must NOT consume it — the two signals
        are independent. The recipient can still open it exactly once."""
        a, b = couple_session
        files = {"file": ("secret.png", io.BytesIO(_tiny_png_bytes()), "image/png")}
        data = {"media_type": "image", "privacy": "one_time"}
        r = requests.post(f"{API}/messages/media", files=files, data=data,
                          headers={"X-User-Id": a["user_id"]}, timeout=60)
        assert r.status_code == 200, r.text
        msg = r.json()

        # B marks read (chat is focused) — read_at set, consumed stays False
        rr = requests.post(f"{API}/messages/read", json={"message_ids": [msg["id"]]},
                           headers={"X-User-Id": b["user_id"]}, timeout=15)
        assert rr.status_code == 200

        rl = requests.get(f"{API}/messages", headers={"X-User-Id": b["user_id"]}, timeout=15)
        item = next(m for m in rl.json() if m["id"] == msg["id"])
        assert item["read_at"] is not None
        assert item["consumed"] is False
        assert item["can_open"] is True

        # And opening it once still works afterwards
        ro = requests.post(f"{API}/messages/{msg['id']}/open", json={},
                           headers={"X-User-Id": b["user_id"]}, timeout=15)
        assert ro.status_code == 200
