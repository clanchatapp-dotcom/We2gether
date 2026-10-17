from fastapi import FastAPI, APIRouter, HTTPException, Header, UploadFile, File, Form, Query, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import random
import string
import uuid
import requests
import httpx
from pathlib import Path
from pydantic import BaseModel
from typing import Optional
from urllib.parse import urlparse
from datetime import datetime, timezone
from zoneinfo import ZoneInfo


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Object storage (Supabase preferred, fallback to Emergent managed)
# ---------------------------------------------------------------------------
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
SUPABASE_BUCKET = os.environ.get("SUPABASE_BUCKET") or "chat-media"

STORAGE_BASE = (
    os.environ.get("INTEGRATION_PROXY_URL") or ""
).strip() or "https://integrations.emergentagent.com"

STORAGE_URL = (
    STORAGE_BASE.rstrip("/") +
    "/objstore/api/v1/storage"
)

EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "get2gether"
storage_key = None


def init_storage():
    """
    Initialise the Emergent-managed storage (keeps backwards compatibility).
    When SUPABASE_URL + SUPABASE_SERVICE_KEY are provided, Supabase will be
    used for uploads/downloads instead of the Emergent object proxy.
    """
    global storage_key

    # If Supabase is configured we don't need to init the Emergent storage.
    if SUPABASE_URL and SUPABASE_SERVICE_KEY:
        return SUPABASE_SERVICE_KEY

    if storage_key:
        return storage_key

    resp = requests.post(
        f"{STORAGE_URL}/init",
        json={"emergent_key": EMERGENT_KEY},
        timeout=30,
    )

    resp.raise_for_status()

    storage_key = resp.json()["storage_key"]

    return storage_key


def put_object(
    path: str,
    data: bytes,
    content_type: str,
) -> dict:
    """
    Upload bytes to object storage. Prefer Supabase when configured, fall back
    to the Emergent-managed proxy.

    Returns a JSON-like dict on success (supabase returns metadata) or the
    Emergent service's JSON response.
    """
    # Use Supabase Storage REST API if configured.
    if SUPABASE_URL and SUPABASE_SERVICE_KEY:
        # Supabase storage upload endpoint (raw PUT to object path)
        url = f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/{SUPABASE_BUCKET}/{path}"
        headers = {
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type": content_type,
        }

        resp = requests.put(url, headers=headers, data=data, timeout=120)

        # If service role key is invalid or service unavailable, bubble up
        if resp.status_code in (401, 403, 503):
            raise Exception(f"Supabase storage error: {resp.status_code} {resp.text}")

        resp.raise_for_status()

        # Supabase returns JSON metadata on success; keep it for parity.
        try:
            return resp.json()
        except Exception:
            return {"ok": True}

    # Fallback to Emergent-managed storage
    global storage_key

    key = init_storage()

    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={
            "X-Storage-Key": key,
            "Content-Type": content_type,
        },
        data=data,
        timeout=120,
    )

    # The cached storage_key can expire/rotate on the
    # storage service side. Reinitialise and retry once.
    if resp.status_code in (401, 403, 503):
        storage_key = None

        key = init_storage()

        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={
                "X-Storage-Key": key,
                "Content-Type": content_type,
            },
            data=data,
            timeout=120,
        )

    resp.raise_for_status()

    return resp.json()


def get_object(path: str):
    """
    Retrieve bytes and content-type from storage. Use Supabase if configured,
    otherwise fall back to the Emergent-managed proxy.
    Returns (content_bytes, content_type)
    """
    # Supabase path download
    if SUPABASE_URL and SUPABASE_SERVICE_KEY:
        url = f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/{SUPABASE_BUCKET}/{path}"
        headers = {
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        }

        resp = requests.get(url, headers=headers, timeout=60)

        if resp.status_code in (401, 403, 503):
            raise Exception(f"Supabase storage error: {resp.status_code} {resp.text}")

        resp.raise_for_status()

        content_type = resp.headers.get("Content-Type", "application/octet-stream")
        return resp.content, content_type

    # Fallback: Emergent-managed storage
    global storage_key

    key = init_storage()

    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={
            "X-Storage-Key": key,
        },
        timeout=60,
    )

    if resp.status_code in (401, 403, 503):
        storage_key = None

        key = init_storage()

        resp = requests.get(
            f"{STORAGE_URL}/objects/{path}",
            headers={
                "X-Storage-Key": key,
            },
            timeout=60,
        )

    resp.raise_for_status()

    return (
        resp.content,
        resp.headers.get(
            "Content-Type",
            "application/octet-stream",
        ),
    )


UK_TZ = ZoneInfo("Europe/London")


def uk_today() -> str:
    return datetime.now(UK_TZ).date().isoformat()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def gen_code() -> str:
    return "".join(
        random.choices(
            string.ascii_uppercase + string.digits,
            k=6,
        )
    )

# ---------------------------------------------------------------------------
# Push notifications (Emergent managed relay)
# ---------------------------------------------------------------------------
PUSH_BASE_URL = "https://integrations.emergentagent.com"

PUSH_KEY = os.environ.get(
    "EMERGENT_PUSH_KEY",
    "placeholder",
)

_push_client = httpx.AsyncClient(
    base_url=PUSH_BASE_URL,
    headers={
        "X-Push-Key": PUSH_KEY,
    },
    timeout=10.0,
)

# (rest of file unchanged...)
