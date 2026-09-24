import os
import pytest
import requests


BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://couples-sync-app-1.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture
def api_client():
    s = requests.Session()
    return s


@pytest.fixture(scope="session")
def couple_pair():
    """Create Alex + Masha space, return (alex_id, masha_id, couple_id, code)."""
    r = requests.post(f"{BASE_URL}/api/couples/create", json={"name": "TEST_Alex"}, timeout=30)
    assert r.status_code == 200, r.text
    a = r.json()
    alex_id = a["user_id"]
    code = a["code"]
    couple_id = a["couple_id"]
    r2 = requests.post(f"{BASE_URL}/api/couples/join", json={"name": "TEST_Masha", "code": code}, timeout=30)
    assert r2.status_code == 200, r2.text
    masha_id = r2.json()["user_id"]
    return alex_id, masha_id, couple_id, code
