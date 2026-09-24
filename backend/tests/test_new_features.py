"""Tests for the two NEW features: Anniversary + Typing indicator."""
import os
import time
import requests
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

UK_TZ = ZoneInfo("Europe/London")


# ============================================================
# ANNIVERSARY (Feature B)
# ============================================================
class TestAnniversary:
    def test_default_anniversary_returned_via_me(self, couple_pair):
        from conftest import BASE_URL
        alex_id, _, _, _ = couple_pair
        r = requests.get(f"{BASE_URL}/api/couples/me", headers={"X-User-Id": alex_id})
        assert r.status_code == 200
        j = r.json()
        # falls back to since_date for freshly-created couples
        assert ("anniversary_date" in j) and j["anniversary_date"], j
        # ISO-ish YYYY-MM-DD
        datetime.strptime(j["anniversary_date"], "%Y-%m-%d")

    def test_set_past_anniversary_then_get(self, couple_pair):
        from conftest import BASE_URL
        alex_id, masha_id, _, _ = couple_pair
        past = (datetime.now(UK_TZ).date() - timedelta(days=1000)).isoformat()
        r = requests.post(f"{BASE_URL}/api/couples/anniversary",
                          headers={"X-User-Id": alex_id, "Content-Type": "application/json"},
                          json={"date": past})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["anniversary_date"] == past

        # Partner also sees the shared date
        r = requests.get(f"{BASE_URL}/api/couples/me", headers={"X-User-Id": masha_id})
        assert r.status_code == 200
        assert r.json()["anniversary_date"] == past

    def test_future_anniversary_rejected(self, couple_pair):
        from conftest import BASE_URL
        alex_id, _, _, _ = couple_pair
        future = (datetime.now(UK_TZ).date() + timedelta(days=5)).isoformat()
        r = requests.post(f"{BASE_URL}/api/couples/anniversary",
                          headers={"X-User-Id": alex_id, "Content-Type": "application/json"},
                          json={"date": future})
        assert r.status_code == 400

    def test_bad_format_rejected(self, couple_pair):
        from conftest import BASE_URL
        alex_id, _, _, _ = couple_pair
        r = requests.post(f"{BASE_URL}/api/couples/anniversary",
                          headers={"X-User-Id": alex_id, "Content-Type": "application/json"},
                          json={"date": "15/06/2020"})
        assert r.status_code == 400


# ============================================================
# TYPING INDICATOR (Feature A)
# ============================================================
class TestTypingIndicator:
    def test_no_partner_typing_by_default(self, couple_pair):
        from conftest import BASE_URL
        alex_id, _, _, _ = couple_pair
        r = requests.get(f"{BASE_URL}/api/typing", headers={"X-User-Id": alex_id})
        assert r.status_code == 200
        assert r.json()["partner_typing"] is False

    def test_self_typing_not_reflected_to_self(self, couple_pair):
        from conftest import BASE_URL
        alex_id, _, _, _ = couple_pair
        r = requests.post(f"{BASE_URL}/api/typing", headers={"X-User-Id": alex_id})
        assert r.status_code == 200
        # Alex asks — should NOT see herself as partner_typing
        r = requests.get(f"{BASE_URL}/api/typing", headers={"X-User-Id": alex_id})
        assert r.status_code == 200
        assert r.json()["partner_typing"] is False

    def test_partner_typing_visible_then_expires(self, couple_pair):
        from conftest import BASE_URL
        alex_id, masha_id, _, _ = couple_pair
        # Masha pings typing
        r = requests.post(f"{BASE_URL}/api/typing", headers={"X-User-Id": masha_id})
        assert r.status_code == 200
        # Alex sees Masha typing (within 6s)
        r = requests.get(f"{BASE_URL}/api/typing", headers={"X-User-Id": alex_id})
        assert r.status_code == 200
        assert r.json()["partner_typing"] is True, r.json()

        # After ~7s it should clear
        time.sleep(7)
        r = requests.get(f"{BASE_URL}/api/typing", headers={"X-User-Id": alex_id})
        assert r.status_code == 200
        assert r.json()["partner_typing"] is False, "typing should expire after ~6s"
