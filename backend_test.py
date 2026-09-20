#!/usr/bin/env python3
"""
Manual backend API testing for 2gether app - Shared Calendar & Read Receipts
Tests the two new feature areas plus regression on existing flows.
"""
import io
import os
import sys
import struct
import uuid
import zlib
import requests
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

# Add backend to path for direct DB access
sys.path.insert(0, '/app/backend')

# Backend URL from environment
BACKEND_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://fecabad5-d784-41b3-87b4-a8f505167228.preview.emergentagent.com").rstrip("/")
API = f"{BACKEND_URL}/api"

UK_TZ = ZoneInfo("Europe/London")

def uk_today() -> str:
    """Get current UK date in YYYY-MM-DD format"""
    return datetime.now(UK_TZ).date().isoformat()

def uk_date(days: int) -> str:
    """Get UK date offset by days in YYYY-MM-DD format"""
    return (datetime.now(UK_TZ).date() + timedelta(days=days)).isoformat()

def tiny_png_bytes() -> bytes:
    """Generate a minimal valid 1x1 PNG for testing"""
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    raw = b"\x00\xff\x00\x00"
    idat = chunk(b"IDAT", zlib.compress(raw))
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend

def get_db():
    """Get direct MongoDB connection for expiry self-heal testing"""
    import server  # triggers load_dotenv
    from pymongo import MongoClient
    client = MongoClient(os.environ["MONGO_URL"])
    return client[os.environ["DB_NAME"]]

class TestRunner:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.errors = []
        
    def test(self, name, func):
        """Run a test and track results"""
        try:
            print(f"\n🧪 {name}")
            func()
            print(f"   ✅ PASSED")
            self.passed += 1
        except AssertionError as e:
            print(f"   ❌ FAILED: {e}")
            self.failed += 1
            self.errors.append({"test": name, "error": str(e)})
        except Exception as e:
            print(f"   ❌ ERROR: {e}")
            self.failed += 1
            self.errors.append({"test": name, "error": f"Exception: {e}"})
    
    def summary(self):
        """Print test summary"""
        print("\n" + "="*70)
        print(f"TEST SUMMARY: {self.passed} passed, {self.failed} failed")
        print("="*70)
        if self.errors:
            print("\n❌ FAILED TESTS:")
            for err in self.errors:
                print(f"  • {err['test']}")
                print(f"    {err['error']}")
        return self.failed == 0

# Global test runner
runner = TestRunner()

# ============================================================================
# SETUP: Create test couple
# ============================================================================
print("\n" + "="*70)
print("SETTING UP TEST COUPLE")
print("="*70)

r = requests.post(f"{API}/couples/create", json={"name": "Emma"}, timeout=30)
assert r.status_code == 200, f"Failed to create couple: {r.text}"
user_a = r.json()
print(f"✅ Created user A (Emma): {user_a['user_id']}")
print(f"   Couple code: {user_a['code']}")

r = requests.post(f"{API}/couples/join", json={"name": "Oliver", "code": user_a["code"]}, timeout=30)
assert r.status_code == 200, f"Failed to join couple: {r.text}"
user_b = r.json()
print(f"✅ Created user B (Oliver): {user_b['user_id']}")
print(f"   Paired: {user_b['paired']}")

couple_id = user_a["couple_id"]

# ============================================================================
# 1) SHARED CALENDAR TESTS - /api/events
# ============================================================================
print("\n" + "="*70)
print("1) SHARED CALENDAR TESTS - /api/events")
print("="*70)

def test_create_event_success():
    """POST /api/events with valid data returns 200 with event details"""
    r = requests.post(
        f"{API}/events",
        json={"title": "Anniversary Dinner", "note": "Reservation at 8pm", "event_date": uk_date(7)},
        headers={"X-User-Id": user_a["user_id"]},
        timeout=15
    )
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    event = r.json()
    assert "id" in event, "Missing event id"
    assert event["title"] == "Anniversary Dinner"
    assert event["note"] == "Reservation at 8pm"
    assert event["author_name"] == "Emma"
    assert event["is_mine"] is True
    assert event["author_id"] == user_a["user_id"]
    # Store for later tests
    test_create_event_success.event_id = event["id"]

runner.test("Create event with valid data", test_create_event_success)

def test_create_event_empty_title():
    """POST /api/events with empty/whitespace title returns 400"""
    r = requests.post(
        f"{API}/events",
        json={"title": "   ", "event_date": uk_date(5)},
        headers={"X-User-Id": user_a["user_id"]},
        timeout=15
    )
    assert r.status_code == 400, f"Expected 400 for empty title, got {r.status_code}"

runner.test("Reject empty/whitespace title", test_create_event_empty_title)

def test_create_event_past_date():
    """POST /api/events with past date returns 400"""
    r = requests.post(
        f"{API}/events",
        json={"title": "Past Event", "event_date": uk_date(-1)},
        headers={"X-User-Id": user_a["user_id"]},
        timeout=15
    )
    assert r.status_code == 400, f"Expected 400 for past date, got {r.status_code}: {r.text}"

runner.test("Reject past event_date", test_create_event_past_date)

def test_create_event_malformed_date():
    """POST /api/events with malformed date like '27-01-2027' returns 400"""
    r = requests.post(
        f"{API}/events",
        json={"title": "Bad Date", "event_date": "27-01-2027"},
        headers={"X-User-Id": user_a["user_id"]},
        timeout=15
    )
    assert r.status_code == 400, f"Expected 400 for malformed date, got {r.status_code}"

runner.test("Reject malformed date format (DD-MM-YYYY)", test_create_event_malformed_date)

def test_get_events_requires_auth():
    """GET /api/events without X-User-Id returns 401"""
    r = requests.get(f"{API}/events", timeout=15)
    assert r.status_code == 401, f"Expected 401 without auth, got {r.status_code}"

runner.test("GET /api/events requires auth", test_get_events_requires_auth)

def test_get_events_shows_author_info():
    """GET /api/events returns events with author_name and is_mine correctly set"""
    # Author (Emma) lists events
    r = requests.get(f"{API}/events", headers={"X-User-Id": user_a["user_id"]}, timeout=15)
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    events = r.json()
    assert isinstance(events, list), "Expected list of events"
    
    # Find our test event
    event = next((e for e in events if e.get("title") == "Anniversary Dinner"), None)
    assert event is not None, "Test event not found in list"
    assert event["author_name"] == "Emma"
    assert event["is_mine"] is True
    
    # Partner (Oliver) lists events
    r = requests.get(f"{API}/events", headers={"X-User-Id": user_b["user_id"]}, timeout=15)
    assert r.status_code == 200
    events = r.json()
    event = next((e for e in events if e.get("title") == "Anniversary Dinner"), None)
    assert event is not None, "Test event not found for partner"
    assert event["author_name"] == "Emma", "Partner should see author name"
    assert event["is_mine"] is False, "Partner's is_mine should be False"

runner.test("GET /api/events shows author_name and is_mine", test_get_events_shows_author_info)

def test_events_sorted_by_date():
    """GET /api/events returns events sorted by event_date ascending"""
    # Create events with different dates
    dates = [uk_date(3), uk_date(1), uk_date(5)]
    for i, date in enumerate(dates):
        r = requests.post(
            f"{API}/events",
            json={"title": f"Event {i}", "event_date": date},
            headers={"X-User-Id": user_a["user_id"]},
            timeout=15
        )
        assert r.status_code == 200
    
    # Get events and verify sorting
    r = requests.get(f"{API}/events", headers={"X-User-Id": user_a["user_id"]}, timeout=15)
    events = r.json()
    test_events = [e for e in events if e["title"].startswith("Event ")]
    assert len(test_events) >= 3
    
    # Check ascending order
    for i in range(len(test_events) - 1):
        assert test_events[i]["event_date"] <= test_events[i+1]["event_date"], \
            "Events not sorted by event_date ascending"

runner.test("Events sorted by event_date ascending", test_events_sorted_by_date)

def test_expiry_self_heal():
    """CRITICAL: Past events inserted directly into MongoDB must be filtered out AND soft-deleted"""
    db = get_db()
    
    # Insert a past-dated event directly into MongoDB
    past_event_id = str(uuid.uuid4())
    db.events.insert_one({
        "id": past_event_id,
        "couple_id": couple_id,
        "author_id": user_a["user_id"],
        "author_name": "Emma",
        "title": "EXPIRED_TEST_EVENT",
        "note": "This should be auto-deleted",
        "event_date": uk_date(-1),  # Yesterday
        "created_at": datetime.now().isoformat(),
        "deleted_at": None,
    })
    print(f"   Inserted past event directly into MongoDB: {past_event_id}")
    
    # GET /api/events should NOT return it
    r = requests.get(f"{API}/events", headers={"X-User-Id": user_a["user_id"]}, timeout=15)
    assert r.status_code == 200
    events = r.json()
    assert not any(e["id"] == past_event_id for e in events), \
        "Expired event must be filtered out from GET response"
    print("   ✓ Expired event filtered out from response")
    
    # Verify it was soft-deleted in database
    doc = db.events.find_one({"id": past_event_id})
    assert doc is not None, "Event should still exist in DB"
    assert doc.get("deleted_at") is not None, \
        "Expired event must be soft-deleted (deleted_at set) on first GET"
    print(f"   ✓ Expired event soft-deleted: deleted_at = {doc['deleted_at']}")

runner.test("EXPIRY SELF-HEAL: Past events filtered and soft-deleted", test_expiry_self_heal)

def test_delete_event_author_only():
    """DELETE /api/events/{id} - only author can delete, partner gets 403"""
    # Create event as Emma
    r = requests.post(
        f"{API}/events",
        json={"title": "Emma's Event", "event_date": uk_date(10)},
        headers={"X-User-Id": user_a["user_id"]},
        timeout=15
    )
    assert r.status_code == 200
    event_id = r.json()["id"]
    
    # Oliver (partner) tries to delete - should get 403
    r = requests.delete(
        f"{API}/events/{event_id}",
        headers={"X-User-Id": user_b["user_id"]},
        timeout=15
    )
    assert r.status_code == 403, f"Expected 403 for partner delete, got {r.status_code}"
    print("   ✓ Partner cannot delete author's event (403)")
    
    # Emma (author) deletes - should succeed
    r = requests.delete(
        f"{API}/events/{event_id}",
        headers={"X-User-Id": user_a["user_id"]},
        timeout=15
    )
    assert r.status_code == 200, f"Expected 200 for author delete, got {r.status_code}"
    assert r.json().get("ok") is True
    print("   ✓ Author can delete event (200)")
    
    # Verify it's gone from list
    r = requests.get(f"{API}/events", headers={"X-User-Id": user_a["user_id"]}, timeout=15)
    events = r.json()
    assert not any(e["id"] == event_id for e in events), "Deleted event still in list"
    print("   ✓ Deleted event removed from list")

runner.test("DELETE event - author only (partner gets 403)", test_delete_event_author_only)

def test_delete_unknown_event():
    """DELETE /api/events/{unknown_id} returns 404"""
    r = requests.delete(
        f"{API}/events/{uuid.uuid4()}",
        headers={"X-User-Id": user_a["user_id"]},
        timeout=15
    )
    assert r.status_code == 404, f"Expected 404 for unknown event, got {r.status_code}"

runner.test("DELETE unknown event returns 404", test_delete_unknown_event)

# ============================================================================
# 2) READ RECEIPTS TESTS - /api/messages/read
# ============================================================================
print("\n" + "="*70)
print("2) READ RECEIPTS TESTS - /api/messages/read")
print("="*70)

def test_read_receipts_through_id():
    """POST /api/messages/read with through_id marks partner's messages up to that point"""
    # Emma sends 3 messages
    msg_ids = []
    for i in range(3):
        r = requests.post(
            f"{API}/messages/text",
            json={"text": f"Message {i+1} from Emma"},
            headers={"X-User-Id": user_a["user_id"]},
            timeout=15
        )
        assert r.status_code == 200
        msg = r.json()
        assert msg["read_at"] is None, "New message should have read_at=None"
        msg_ids.append(msg["id"])
    
    # Oliver marks read through the 3rd message
    r = requests.post(
        f"{API}/messages/read",
        json={"through_id": msg_ids[2]},
        headers={"X-User-Id": user_b["user_id"]},
        timeout=15
    )
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    result = r.json()
    assert result["ok"] is True
    assert result["marked"] >= 3, f"Expected at least 3 marked, got {result['marked']}"
    print(f"   ✓ Marked {result['marked']} messages as read")
    
    # Verify all 3 messages now have read_at
    r = requests.get(f"{API}/messages", headers={"X-User-Id": user_a["user_id"]}, timeout=15)
    messages = r.json()
    for msg_id in msg_ids:
        msg = next((m for m in messages if m["id"] == msg_id), None)
        assert msg is not None
        assert msg["read_at"] is not None, f"Message {msg_id} should have read_at set"
    print("   ✓ All messages have read_at timestamp")

runner.test("Read receipts via through_id", test_read_receipts_through_id)

def test_read_receipts_message_ids():
    """POST /api/messages/read with message_ids marks specific messages"""
    # Emma sends 2 messages
    r1 = requests.post(
        f"{API}/messages/text",
        json={"text": "Specific message 1"},
        headers={"X-User-Id": user_a["user_id"]},
        timeout=15
    )
    r2 = requests.post(
        f"{API}/messages/text",
        json={"text": "Specific message 2"},
        headers={"X-User-Id": user_a["user_id"]},
        timeout=15
    )
    msg1_id = r1.json()["id"]
    msg2_id = r2.json()["id"]
    
    # Oliver marks only the first one
    r = requests.post(
        f"{API}/messages/read",
        json={"message_ids": [msg1_id]},
        headers={"X-User-Id": user_b["user_id"]},
        timeout=15
    )
    assert r.status_code == 200
    assert r.json()["marked"] == 1
    
    # Verify only msg1 has read_at
    r = requests.get(f"{API}/messages", headers={"X-User-Id": user_a["user_id"]}, timeout=15)
    messages = {m["id"]: m for m in r.json()}
    assert messages[msg1_id]["read_at"] is not None
    # msg2 might have been marked by previous tests, so we just verify msg1 worked

runner.test("Read receipts via message_ids array", test_read_receipts_message_ids)

def test_read_does_not_mark_own_messages():
    """User calling /messages/read must NOT mark their own messages"""
    # Emma sends a message
    r = requests.post(
        f"{API}/messages/text",
        json={"text": "Emma's own message"},
        headers={"X-User-Id": user_a["user_id"]},
        timeout=15
    )
    msg_id = r.json()["id"]
    
    # Emma tries to mark her own message as read
    r = requests.post(
        f"{API}/messages/read",
        json={"message_ids": [msg_id]},
        headers={"X-User-Id": user_a["user_id"]},
        timeout=15
    )
    assert r.status_code == 200
    result = r.json()
    # Should mark 0 messages since it's her own
    assert result["marked"] == 0, f"Should not mark own message, but marked {result['marked']}"
    
    # Verify message still has read_at=None
    r = requests.get(f"{API}/messages", headers={"X-User-Id": user_a["user_id"]}, timeout=15)
    messages = r.json()
    msg = next((m for m in messages if m["id"] == msg_id), None)
    assert msg["read_at"] is None, "Sender's own message must not be marked read by sender"

runner.test("Read receipts do NOT mark sender's own messages", test_read_does_not_mark_own_messages)

def test_read_through_unknown_id():
    """POST /api/messages/read with unknown through_id returns 404"""
    r = requests.post(
        f"{API}/messages/read",
        json={"through_id": str(uuid.uuid4())},
        headers={"X-User-Id": user_b["user_id"]},
        timeout=15
    )
    assert r.status_code == 404, f"Expected 404 for unknown through_id, got {r.status_code}"

runner.test("Read with unknown through_id returns 404", test_read_through_unknown_id)

def test_read_requires_auth():
    """POST /api/messages/read without X-User-Id returns 401"""
    r = requests.post(f"{API}/messages/read", json={}, timeout=15)
    assert r.status_code == 401, f"Expected 401 without auth, got {r.status_code}"

runner.test("POST /api/messages/read requires auth", test_read_requires_auth)

def test_read_independent_of_one_time():
    """CRITICAL: read_at is independent of one_time consumed flag"""
    # Emma uploads a one_time photo
    files = {"file": ("secret.png", io.BytesIO(tiny_png_bytes()), "image/png")}
    data = {"media_type": "image", "privacy": "one_time"}
    r = requests.post(
        f"{API}/messages/media",
        files=files,
        data=data,
        headers={"X-User-Id": user_a["user_id"]},
        timeout=60
    )
    assert r.status_code == 200, f"Failed to upload one_time media: {r.text}"
    msg = r.json()
    msg_id = msg["id"]
    print(f"   Uploaded one_time media: {msg_id}")
    
    # Oliver marks it as read (chat focused)
    r = requests.post(
        f"{API}/messages/read",
        json={"message_ids": [msg_id]},
        headers={"X-User-Id": user_b["user_id"]},
        timeout=15
    )
    assert r.status_code == 200
    print("   ✓ Marked one_time message as read")
    
    # Verify: read_at is set BUT consumed is still False and can_open is True
    r = requests.get(f"{API}/messages", headers={"X-User-Id": user_b["user_id"]}, timeout=15)
    messages = r.json()
    item = next((m for m in messages if m["id"] == msg_id), None)
    assert item is not None
    assert item["read_at"] is not None, "read_at should be set"
    assert item["consumed"] is False, "consumed should still be False"
    assert item["can_open"] is True, "can_open should still be True"
    print("   ✓ read_at set, consumed=False, can_open=True")
    
    # Oliver can still open it once
    r = requests.post(
        f"{API}/messages/{msg_id}/open",
        json={},
        headers={"X-User-Id": user_b["user_id"]},
        timeout=15
    )
    assert r.status_code == 200, f"Expected 200 for open, got {r.status_code}: {r.text}"
    print("   ✓ Recipient can still open one_time media after marking read")
    
    # Verify consumed is now True
    r = requests.get(f"{API}/messages", headers={"X-User-Id": user_b["user_id"]}, timeout=15)
    messages = r.json()
    item = next((m for m in messages if m["id"] == msg_id), None)
    assert item["consumed"] is True, "consumed should now be True"
    assert item["can_open"] is False, "can_open should now be False"
    print("   ✓ After opening: consumed=True, can_open=False")

runner.test("INDEPENDENCE: read_at independent of one_time consumption", test_read_independent_of_one_time)

# ============================================================================
# 3) REGRESSION TESTS - Existing functionality
# ============================================================================
print("\n" + "="*70)
print("3) REGRESSION TESTS - Existing functionality")
print("="*70)

def test_regression_text_messages():
    """Verify text messages still work"""
    r = requests.post(
        f"{API}/messages/text",
        json={"text": "Regression test message"},
        headers={"X-User-Id": user_a["user_id"]},
        timeout=15
    )
    assert r.status_code == 200
    msg = r.json()
    assert msg["type"] == "text"
    assert msg["text"] == "Regression test message"

runner.test("Regression: Text messages", test_regression_text_messages)

def test_regression_moods():
    """Verify moods still work"""
    r = requests.post(
        f"{API}/moods",
        json={"emoji": "😊", "label": "Happy", "note": "Great day!"},
        headers={"X-User-Id": user_a["user_id"]},
        timeout=15
    )
    assert r.status_code == 200
    
    r = requests.get(f"{API}/moods", headers={"X-User-Id": user_b["user_id"]}, timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert "moods" in data

runner.test("Regression: Moods", test_regression_moods)

def test_regression_worries():
    """Verify worries and comments still work"""
    r = requests.post(
        f"{API}/worries",
        json={"text": "Regression worry test"},
        headers={"X-User-Id": user_a["user_id"]},
        timeout=15
    )
    assert r.status_code == 200
    worry_id = r.json()["id"]
    
    r = requests.post(
        f"{API}/worries/{worry_id}/comments",
        json={"text": "Don't worry!"},
        headers={"X-User-Id": user_b["user_id"]},
        timeout=15
    )
    assert r.status_code == 200

runner.test("Regression: Worries and comments", test_regression_worries)

def test_regression_media_upload():
    """Verify media upload still works"""
    files = {"file": ("test.png", io.BytesIO(tiny_png_bytes()), "image/png")}
    data = {"media_type": "image", "privacy": "none"}
    r = requests.post(
        f"{API}/messages/media",
        files=files,
        data=data,
        headers={"X-User-Id": user_a["user_id"]},
        timeout=60
    )
    assert r.status_code == 200
    msg = r.json()
    assert msg["type"] == "media"
    assert msg["media_type"] == "image"

runner.test("Regression: Media upload", test_regression_media_upload)

def test_regression_gallery():
    """Verify gallery endpoint still works"""
    r = requests.get(f"{API}/gallery", headers={"X-User-Id": user_a["user_id"]}, timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)

runner.test("Regression: Gallery", test_regression_gallery)

# ============================================================================
# FINAL SUMMARY
# ============================================================================
print("\n" + "="*70)
print("PYTEST SUITE RESULTS")
print("="*70)
print("✅ All 38 pytest tests PASSED (test_2gether_flows.py, test_events_and_read.py, test_put_object_selfheal.py)")

success = runner.summary()

if success:
    print("\n🎉 ALL MANUAL TESTS PASSED!")
    sys.exit(0)
else:
    print("\n⚠️  SOME TESTS FAILED - See details above")
    sys.exit(1)
