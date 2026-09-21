from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import random
import string
import uuid
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone

import requests

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# ---------------------------------------------------------------------------
# Object storage (Emergent)
# ---------------------------------------------------------------------------
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "we2gether"
storage_key = None

MIME_TYPES = {
    "jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
    "gif": "image/gif", "webp": "image/webp",
}


def init_storage(force: bool = False):
    global storage_key
    if storage_key and not force:
        return storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=120,
    )
    if resp.status_code == 404:
        key = init_storage(force=True)
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data, timeout=120,
        )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str):
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    if resp.status_code == 404:
        key = init_storage(force=True)
        resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
def now_iso():
    return datetime.now(timezone.utc).isoformat()


class Space(BaseModel):
    code: str
    created_at: str = Field(default_factory=now_iso)


class EventCreate(BaseModel):
    code: str
    title: str
    start: str  # ISO 8601 UTC
    end: str    # ISO 8601 UTC
    category: Optional[str] = "Reminder"
    note: Optional[str] = ""


class Event(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    code: str
    title: str
    start: str
    end: str
    category: str = "Reminder"
    note: str = ""
    created_at: str = Field(default_factory=now_iso)


class MessageCreate(BaseModel):
    code: str
    sender: str  # device/user identifier
    text: str


class Message(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    code: str
    sender: str
    text: str
    created_at: str = Field(default_factory=now_iso)


def gen_code(n: int = 6) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(n))


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@api_router.get("/")
async def root():
    return {"message": "We2gether API"}


@api_router.post("/spaces", response_model=Space)
async def create_space():
    for _ in range(10):
        code = gen_code()
        exists = await db.spaces.find_one({"code": code})
        if not exists:
            space = Space(code=code)
            await db.spaces.insert_one(space.model_dump())
            return space
    raise HTTPException(status_code=500, detail="Could not generate a unique code")


@api_router.get("/spaces/{code}", response_model=Space)
async def get_space(code: str):
    code = code.upper().strip()
    doc = await db.spaces.find_one({"code": code}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Pairing code not found")
    return Space(**doc)


# ---- Events ----
@api_router.get("/events", response_model=List[Event])
async def list_events(code: str):
    code = code.upper().strip()
    docs = await db.events.find({"code": code}, {"_id": 0}).to_list(1000)
    docs.sort(key=lambda d: d.get("start", ""))
    return [Event(**d) for d in docs]


@api_router.post("/events", response_model=Event)
async def create_event(payload: EventCreate):
    code = payload.code.upper().strip()
    space = await db.spaces.find_one({"code": code})
    if not space:
        raise HTTPException(status_code=404, detail="Pairing code not found")
    # Normalize incoming times to UTC ISO
    ev = Event(
        code=code,
        title=payload.title,
        start=_to_utc_iso(payload.start),
        end=_to_utc_iso(payload.end),
        category=payload.category or "Reminder",
        note=payload.note or "",
    )
    await db.events.insert_one(ev.model_dump())
    return ev


@api_router.delete("/events/{event_id}")
async def delete_event(event_id: str):
    res = await db.events.delete_one({"id": event_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Event not found")
    return {"ok": True}


def _to_utc_iso(value: str) -> str:
    """Parse an ISO string (with or without tz) and return UTC ISO 8601."""
    v = value.replace("Z", "+00:00")
    dt = datetime.fromisoformat(v)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


# ---- Messages (chat) ----
@api_router.get("/messages", response_model=List[Message])
async def list_messages(code: str):
    code = code.upper().strip()
    docs = await db.messages.find({"code": code}, {"_id": 0}).to_list(1000)
    docs.sort(key=lambda d: d.get("created_at", ""))
    return [Message(**d) for d in docs]


@api_router.post("/messages", response_model=Message)
async def create_message(payload: MessageCreate):
    code = payload.code.upper().strip()
    space = await db.spaces.find_one({"code": code})
    if not space:
        raise HTTPException(status_code=404, detail="Pairing code not found")
    msg = Message(code=code, sender=payload.sender, text=payload.text)
    await db.messages.insert_one(msg.model_dump())
    return msg


# ---- Gallery ----
@api_router.get("/gallery")
async def list_gallery(code: str):
    code = code.upper().strip()
    docs = await db.gallery.find({"code": code, "is_deleted": False}, {"_id": 0}).to_list(1000)
    docs.sort(key=lambda d: d.get("created_at", ""), reverse=True)
    return docs


@api_router.post("/gallery/upload")
async def upload_gallery(code: str = Form(...), caption: str = Form(""), file: UploadFile = File(...)):
    code = code.upper().strip()
    space = await db.spaces.find_one({"code": code})
    if not space:
        raise HTTPException(status_code=404, detail="Pairing code not found")
    ext = (file.filename or "img").split(".")[-1].lower()
    content_type = MIME_TYPES.get(ext, file.content_type or "application/octet-stream")
    photo_id = str(uuid.uuid4())
    path = f"{APP_NAME}/{code}/{photo_id}.{ext}"
    data = await file.read()
    result = put_object(path, data, content_type)
    record = {
        "id": photo_id,
        "code": code,
        "storage_path": result["path"],
        "original_filename": file.filename,
        "content_type": content_type,
        "caption": caption,
        "size": result.get("size", len(data)),
        "is_deleted": False,
        "created_at": now_iso(),
    }
    await db.gallery.insert_one(record)
    record.pop("_id", None)
    return record


@api_router.get("/gallery/file/{photo_id}")
async def get_gallery_file(photo_id: str):
    record = await db.gallery.find_one({"id": photo_id, "is_deleted": False})
    if not record:
        raise HTTPException(status_code=404, detail="Photo not found")
    data, content_type = get_object(record["storage_path"])
    return Response(content=data, media_type=record.get("content_type", content_type))


@api_router.delete("/gallery/{photo_id}")
async def delete_gallery(photo_id: str):
    res = await db.gallery.update_one({"id": photo_id}, {"$set": {"is_deleted": True}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Photo not found")
    return {"ok": True}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def startup():
    try:
        init_storage()
        logger.info("Object storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
