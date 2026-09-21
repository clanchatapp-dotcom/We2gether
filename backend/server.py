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
# Object storage (Emergent managed)
# ---------------------------------------------------------------------------
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
    global storage_key

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


class RegisterPushBody(BaseModel):
    user_id: str
    platform: str
    device_token: str


async def send_push(
    recipients,
    data: dict,
    idempotency_key: Optional[str] = None,
) -> None:
    """
    Relay a push to the Emergent managed push service.

    Callers wrap this in try/except so a push failure
    never blocks the primary operation.
    """

    recipients = [
        r for r in (recipients or [])
        if r
    ]

    if not recipients:
        return

    if len(recipients) > 100:
        raise ValueError(
            "max 100 recipients per /trigger call; "
            "chunk before sending"
        )

    if (
        "title" not in data
        or "message" not in data
    ):
        raise ValueError(
            "data must include title and message"
        )

    payload: dict = {
        "recipients": recipients,
        "data": data,
    }

    if idempotency_key:
        payload["$idempotency_key"] = (
            idempotency_key
        )

    resp = await _push_client.post(
        "/api/v1/push/trigger",
        json=payload,
    )

    if resp.status_code == 401:
        raise HTTPException(
            500,
            "EMERGENT_PUSH_KEY missing or invalid",
        )

    if resp.status_code >= 500:
        raise HTTPException(
            502,
            "Push provider unavailable",
        )

    resp.raise_for_status()


async def partner_user_ids(
    couple_id: str,
    me_id: str,
):
    """
    Return the other member(s) of a couple.
    """

    couple = await db.couples.find_one(
        {
            "id": couple_id,
            "deleted_at": None,
        }
    )

    if not couple:
        return []

    return [
        m["user_id"]
        for m in couple.get("members", [])
        if m["user_id"] != me_id
    ]


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class CreateCoupleIn(BaseModel):
    name: str


class JoinCoupleIn(BaseModel):
    name: str
    code: str


class TextMessageIn(BaseModel):
    text: str


class GifMessageIn(BaseModel):
    gif_id: str
    gif_url: str
    preview_url: Optional[str] = None
    title: Optional[str] = ""


class MoodIn(BaseModel):
    emoji: str
    label: str
    note: Optional[str] = ""


class WorryIn(BaseModel):
    text: str


class CommentIn(BaseModel):
    text: str


class EventIn(BaseModel):
    title: str
    note: Optional[str] = ""
    event_date: str


class ReadIn(BaseModel):
    through_id: Optional[str] = None
    message_ids: Optional[list[str]] = None


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------
async def get_user(
    x_user_id: Optional[str],
):
    if not x_user_id:
        raise HTTPException(
            status_code=401,
            detail="Missing user",
        )

    user = await db.users.find_one(
        {
            "id": x_user_id,
            "deleted_at": None,
        }
    )

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Invalid user",
        )

    return user


async def couple_public(
    couple,
    me_id,
):
    members = couple.get(
        "members",
        [],
    )

    me = next(
        (
            m
            for m in members
            if m["user_id"] == me_id
        ),
        None,
    )

    partner = next(
        (
            m
            for m in members
            if m["user_id"] != me_id
        ),
        None,
    )

    return {
        "couple_id": couple["id"],
        "code": couple["code"],
        "since_date": couple.get(
            "since_date"
        ),
        "me": me,
        "partner": partner,
        "paired": len(members) >= 2,
    }


# ---------------------------------------------------------------------------
# Couple / pairing
# ---------------------------------------------------------------------------
@api_router.get("/")
async def root():
    return {
        "message": "2gether API"
    }


@api_router.post(
    "/register-push",
    status_code=201,
)
async def register_push(
    body: RegisterPushBody,
):
    resp = await _push_client.post(
        "/api/v1/push/users/register",
        json=body.model_dump(),
    )

    if resp.status_code == 401:
        raise HTTPException(
            500,
            "EMERGENT_PUSH_KEY missing or invalid",
        )

    if resp.status_code >= 500:
        raise HTTPException(
            502,
            "Push provider unavailable",
        )

    resp.raise_for_status()

    return {
        "status": "registered"
    }


@api_router.post("/couples/create")
async def create_couple(
    body: CreateCoupleIn,
):
    name = body.name.strip()

    if not name:
        raise HTTPException(
            status_code=400,
            detail="Name is required",
        )

    code = gen_code()

    while await db.couples.find_one(
        {
            "code": code,
            "deleted_at": None,
        }
    ):
        code = gen_code()

    user_id = str(uuid.uuid4())
    couple_id = str(uuid.uuid4())

    member = {
        "user_id": user_id,
        "name": name,
    }

    couple = {
        "id": couple_id,
        "code": code,
        "since_date": uk_today(),
        "members": [member],
        "created_at": now_iso(),
        "deleted_at": None,
    }

    await db.couples.insert_one(couple)

    await db.users.insert_one(
        {
            "id": user_id,
            "name": name,
            "couple_id": couple_id,
            "created_at": now_iso(),
            "deleted_at": None,
        }
    )

    return {
        "user_id": user_id,
        **(
            await couple_public(
                couple,
                user_id,
            )
        ),
    }


@api_router.post("/couples/join")
async def join_couple(
    body: JoinCoupleIn,
):
    name = body.name.strip()
    code = body.code.strip().upper()

    if not name or not code:
        raise HTTPException(
            status_code=400,
            detail="Name and code are required",
        )

    couple = await db.couples.find_one(
        {
            "code": code,
            "deleted_at": None,
        }
    )

    if not couple:
        raise HTTPException(
            status_code=404,
            detail="No space found with that code",
        )

    if len(
        couple.get("members", [])
    ) >= 2:
        raise HTTPException(
            status_code=409,
            detail="This space is already full",
        )

    user_id = str(uuid.uuid4())

    member = {
        "user_id": user_id,
        "name": name,
    }

    await db.couples.update_one(
        {
            "id": couple["id"]
        },
        {
            "$push": {
                "members": member
            }
        },
    )

    await db.users.insert_one(
        {
            "id": user_id,
            "name": name,
            "couple_id": couple["id"],
            "created_at": now_iso(),
            "deleted_at": None,
        }
    )

    couple = await db.couples.find_one(
        {
            "id": couple["id"]
        }
    )

    return {
        "user_id": user_id,
        **(
            await couple_public(
                couple,
                user_id,
            )
        ),
    }


@api_router.get("/couples/me")
async def get_me(
    x_user_id: Optional[str] = Header(None),
):
    user = await get_user(x_user_id)

    couple = await db.couples.find_one(
        {
            "id": user["couple_id"],
            "deleted_at": None,
        }
    )

    if not couple:
        raise HTTPException(
            status_code=404,
            detail="Space not found",
        )

    return {
        "user_id": user["id"],
        **(
            await couple_public(
                couple,
                user["id"],
            )
        ),
    }


# ---------------------------------------------------------------------------
# Messages / Chat
# ---------------------------------------------------------------------------
def message_public(
    m,
    me_id,
):
    is_mine = (
        m["sender_id"] == me_id
    )

    one_time = (
        m.get("privacy") == "one_time"
    )

    consumed = m.get(
        "consumed",
        False,
    )

    return {
        "id": m["id"],
        "type": m["type"],
        "text": m.get("text"),

        # GIF fields
        "gif_id": m.get("gif_id"),
        "gif_url": m.get("gif_url"),
        "gif_preview_url": m.get(
            "gif_preview_url"
        ),
        "gif_title": m.get(
            "gif_title"
        ),

        "sender_id": m["sender_id"],
        "sender_name": m.get(
            "sender_name"
        ),
        "is_mine": is_mine,
        "privacy": m.get(
            "privacy",
            "none",
        ),
        "media_type": m.get(
            "media_type"
        ),
        "media_path": m.get(
            "media_path"
        ),
        "created_at": m.get(
            "created_at"
        ),
        "consumed": consumed,
        "one_time": one_time,

        "read_at": m.get(
            "read_at"
        ),

        "can_open": (
            (not one_time)
            or (
                not is_mine
                and not consumed
            )
        ),
    }


@api_router.get("/messages")
async def list_messages(
    x_user_id: Optional[str] = Header(None),
):
    user = await get_user(x_user_id)

    cur = (
        db.messages.find(
            {
                "couple_id":
                    user["couple_id"],
                "deleted_at": None,
            }
        )
        .sort(
            "created_at",
            1,
        )
    )

    msgs = await cur.to_list(1000)

    return [
        message_public(
            m,
            user["id"],
        )
        for m in msgs
    ]


@api_router.post("/messages/text")
async def send_text(
    body: TextMessageIn,
    x_user_id: Optional[str] = Header(None),
):
    user = await get_user(
        x_user_id
    )

    text = body.text.strip()

    if not text:
        raise HTTPException(
            status_code=400,
            detail="Empty message",
        )

    m = {
        "id": str(uuid.uuid4()),
        "couple_id": user["couple_id"],
        "sender_id": user["id"],
        "sender_name": user["name"],
        "type": "text",
        "text": text,
        "privacy": "none",
        "created_at": now_iso(),
        "deleted_at": None,
    }

    await db.messages.insert_one(m)

    try:
        recipients = await partner_user_ids(
            user["couple_id"],
            user["id"],
        )

        await send_push(
            recipients=recipients,
            data={
                "title":
                    f"💌 {user['name']}",
                "message":
                    text[:140],
                "action_url":
                    "/(tabs)/chat",
            },
        )

    except Exception as e:
        logger.warning(
            f"Push failed (non-blocking): {e}"
        )

    return message_public(
        m,
        user["id"],
    )


# ---------------------------------------------------------------------------
# GIF messages
# ---------------------------------------------------------------------------
@api_router.post("/messages/gif")
async def send_gif(
    body: GifMessageIn,
    x_user_id: Optional[str] = Header(None),
):
    user = await get_user(
        x_user_id
    )

    gif_id = body.gif_id.strip()
    gif_url = body.gif_url.strip()

    if not gif_id:
        raise HTTPException(
            status_code=400,
            detail="GIF id is required",
        )

    if not gif_url:
        raise HTTPException(
            status_code=400,
            detail="GIF URL is required",
        )

    parsed = urlparse(
        gif_url
    )

    preview = (
        urlparse(body.preview_url)
        if body.preview_url
        else None
    )

    def is_giphy_url(value):
        return (
            value.scheme == "https"
            and value.hostname
            and (
                value.hostname
                == "giphy.com"
                or value.hostname.endswith(
                    ".giphy.com"
                )
            )
        )

    if not is_giphy_url(parsed):
        raise HTTPException(
            status_code=400,
            detail="Invalid GIF URL",
        )

    if (
        preview
        and not is_giphy_url(preview)
    ):
        raise HTTPException(
            status_code=400,
            detail="Invalid GIF preview URL",
        )

    m = {
        "id": str(uuid.uuid4()),
        "couple_id": user["couple_id"],
        "sender_id": user["id"],
        "sender_name": user["name"],
        "type": "gif",
        "gif_id": gif_id,
        "gif_url": gif_url,
        "gif_preview_url":
            body.preview_url or gif_url,
        "gif_title":
            (body.title or "")
            .strip()[:200],
        "privacy": "none",
        "created_at": now_iso(),
        "deleted_at": None,
    }

    await db.messages.insert_one(m)

    try:
        recipients = await partner_user_ids(
            user["couple_id"],
            user["id"],
        )

        await send_push(
            recipients=recipients,
            data={
                "title":
                    f"💌 {user['name']}",
                "message":
                    "Sent you a GIF",
                "action_url":
                    "/(tabs)/chat",
            },
        )

    except Exception as e:
        logger.warning(
            f"Push failed (non-blocking): {e}"
        )

    return message_public(
        m,
        user["id"],
    )


@api_router.post("/messages/media")
async def send_media(
    file: UploadFile = File(...),
    media_type: str = Form("image"),
    privacy: str = Form("none"),
    x_user_id: Optional[str] = Header(None),
):
    user = await get_user(
        x_user_id
    )

    if privacy not in (
        "none",
        "no_save",
        "one_time",
    ):
        privacy = "none"

    data = await file.read()

    ext = (
        (file.filename or "file")
        .split(".")[-1]
        .lower()
    )

    if ext not in (
        "jpg",
        "jpeg",
        "png",
        "gif",
        "webp",
        "mp4",
        "mov",
        "m4v",
        "heic",
    ):
        ext = (
            "jpg"
            if media_type == "image"
            else "mp4"
        )

    path = (
        f"{APP_NAME}/uploads/"
        f"{user['id']}/"
        f"{uuid.uuid4()}.{ext}"
    )

    content_type = (
        file.content_type
        or (
            "image/jpeg"
            if media_type == "image"
            else "video/mp4"
        )
    )

    try:
        await run_in_threadpool(
            put_object,
            path,
            data,
            content_type,
        )

    except Exception as e:
        logger.error(
            f"Media upload failed: {e}"
        )

        raise HTTPException(
            status_code=502,
            detail=(
                "Could not upload media "
                "right now. Please try again."
            ),
        )

    m = {
        "id": str(uuid.uuid4()),
        "couple_id":
            user["couple_id"],
        "sender_id":
            user["id"],
        "sender_name":
            user["name"],
        "type": "media",
        "media_type":
            media_type,
        "media_path":
            path,
        "privacy":
            privacy,
        "consumed":
            False,
        "created_at":
            now_iso(),
        "deleted_at":
            None,
    }

    await db.messages.insert_one(m)

    try:
        recipients = await partner_user_ids(
            user["couple_id"],
            user["id"],
        )

        kind = (
            "a photo"
            if media_type == "image"
            else "a video"
        )

        await send_push(
            recipients=recipients,
            data={
                "title":
                    f"📸 {user['name']}",
                "message":
                    f"Sent you {kind}",
                "action_url":
                    "/(tabs)/chat",
            },
        )

    except Exception as e:
        logger.warning(
            f"Push failed (non-blocking): {e}"
        )

    return message_public(
        m,
        user["id"],
    )


@api_router.post(
    "/messages/{msg_id}/open"
)
async def open_once(
    msg_id: str,
    x_user_id: Optional[str] = Header(None),
):
    """
    Recipient opens a one-time message.
    Marks it consumed so it can't reopen.
    """

    user = await get_user(
        x_user_id
    )

    m = await db.messages.find_one(
        {
            "id": msg_id,
            "couple_id":
                user["couple_id"],
            "deleted_at": None,
        }
    )

    if not m:
        raise HTTPException(
            status_code=404,
            detail="Not found",
        )

    if (
        m.get("privacy")
        != "one_time"
    ):
        return {"ok": True}

    if (
        m["sender_id"]
        == user["id"]
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "Sender cannot open "
                "a one-time message"
            ),
        )

    if m.get("consumed"):
        raise HTTPException(
            status_code=410,
            detail="Already viewed",
        )

    await db.messages.update_one(
        {
            "id": msg_id
        },
        {
            "$set": {
                "consumed": True,
                "consumed_at":
                    now_iso(),
            }
        },
    )

    return {
        "ok": True
    }


@api_router.post(
    "/messages/read"
)
async def mark_read(
    body: ReadIn,
    x_user_id: Optional[str] = Header(None),
):
    """
    Recipient marks the partner's messages
    as read.
    """

    user = await get_user(
        x_user_id
    )

    q: dict = {
        "couple_id":
            user["couple_id"],
        "sender_id":
            {"$ne": user["id"]},
        "deleted_at": None,
        "read_at": None,
    }

    if body.message_ids:
        q["id"] = {
            "$in":
                body.message_ids
        }

    elif body.through_id:
        through = await db.messages.find_one(
            {
                "id":
                    body.through_id,
                "couple_id":
                    user["couple_id"],
                "deleted_at":
                    None,
            }
        )

        if not through:
            raise HTTPException(
                status_code=404,
                detail="Not found",
            )

        q["created_at"] = {
            "$lte":
                through.get(
                    "created_at"
                )
        }

    res = await db.messages.update_many(
        q,
        {
            "$set": {
                "read_at":
                    now_iso()
            }
        },
    )

    return {
        "ok": True,
        "marked":
            res.modified_count,
    }


@api_router.post(
    "/messages/{msg_id}/screenshot"
)
async def report_screenshot(
    msg_id: str,
    x_user_id: Optional[str] = Header(None),
):
    """
    Best-effort report that the viewer just
    screenshotted protected media.
    """

    user = await get_user(
        x_user_id
    )

    m = await db.messages.find_one(
        {
            "id": msg_id,
            "couple_id":
                user["couple_id"],
            "deleted_at": None,
        }
    )

    if (
        not m
        or m.get("privacy")
        not in (
            "no_save",
            "one_time",
        )
        or m["sender_id"]
        == user["id"]
    ):
        return {
            "ok": True
        }

    try:
        recipients = await partner_user_ids(
            user["couple_id"],
            user["id"],
        )

        await send_push(
            recipients=recipients,
            data={
                "title":
                    f"📸 {user['name']}",
                "message":
                    "Took a screenshot of your protected photo",
                "action_url":
                    "/(tabs)/chat",
            },
        )

    except Exception as e:
        logger.warning(
            f"Push failed (non-blocking): {e}"
        )

    return {
        "ok": True
    }


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------
@api_router.get(
    "/files/{path:path}"
)
async def download_file(
    path: str,
    x_user_id: Optional[str] = Header(None),
    uid: Optional[str] = Query(None),
):
    user = await get_user(
        x_user_id or uid
    )

    m = await db.messages.find_one(
        {
            "media_path": path,
            "couple_id":
                user["couple_id"],
            "deleted_at": None,
        }
    )

    if not m:
        raise HTTPException(
            status_code=404,
            detail="Not found",
        )

    if (
        m.get("privacy")
        == "one_time"
    ):
        if (
            m["sender_id"]
            == user["id"]
        ):
            raise HTTPException(
                status_code=410,
                detail="One-time media",
            )

        if not m.get("consumed"):
            raise HTTPException(
                status_code=403,
                detail=(
                    "Open the media first"
                ),
            )

    content, ctype = (
        await run_in_threadpool(
            get_object,
            path,
        )
    )

    return Response(
        content=content,
        media_type=ctype,
    )


# ---------------------------------------------------------------------------
# Gallery
# ---------------------------------------------------------------------------
@api_router.get("/gallery")
async def gallery(
    x_user_id: Optional[str] = Header(None),
):
    user = await get_user(
        x_user_id
    )

    cur = db.messages.find(
        {
            "couple_id":
                user["couple_id"],
            "type": "media",
            "privacy":
                {"$ne": "one_time"},
            "deleted_at": None,
        }
    ).sort(
        "created_at",
        -1,
    )

    msgs = await cur.to_list(1000)

    return [
        message_public(
            m,
            user["id"],
        )
        for m in msgs
    ]


# ---------------------------------------------------------------------------
# Moods
# ---------------------------------------------------------------------------
@api_router.get("/moods")
async def get_moods(
    x_user_id: Optional[str] = Header(None),
):
    user = await get_user(
        x_user_id
    )

    today = uk_today()

    cur = db.moods.find(
        {
            "couple_id":
                user["couple_id"],
            "date": today,
            "deleted_at": None,
        }
    )

    moods = await cur.to_list(10)

    result = {}

    for m in moods:
        result[m["user_id"]] = {
            "user_id":
                m["user_id"],
            "user_name":
                m["user_name"],
            "emoji":
                m["emoji"],
            "label":
                m["label"],
            "note":
                m.get("note", ""),
            "updated_at":
                m.get("updated_at"),
        }

    return {
        "date": today,
        "moods": result,
    }


@api_router.post("/moods")
async def set_mood(
    body: MoodIn,
    x_user_id: Optional[str] = Header(None),
):
    user = await get_user(
        x_user_id
    )

    today = uk_today()

    doc = {
        "id": str(uuid.uuid4()),
        "couple_id":
            user["couple_id"],
        "user_id":
            user["id"],
        "user_name":
            user["name"],
        "emoji":
            body.emoji,
        "label":
            body.label,
        "note":
            (body.note or "").strip(),
        "date":
            today,
        "updated_at":
            now_iso(),
        "deleted_at":
            None,
    }

    await db.moods.update_one(
        {
            "couple_id":
                user["couple_id"],
            "user_id":
                user["id"],
            "date":
                today,
        },
        {
            "$set":
                doc
        },
        upsert=True,
    )

    try:
        recipients = await partner_user_ids(
            user["couple_id"],
            user["id"],
        )

        await send_push(
            recipients=recipients,
            data={
                "title":
                    f"{body.emoji} {user['name']}'s mood",
                "message":
                    body.label
                    + (
                        " · "
                        + doc["note"]
                        if doc["note"]
                        else ""
                    ),
                "action_url":
                    "/(tabs)",
            },
        )

    except Exception as e:
        logger.warning(
            f"Push failed (non-blocking): {e}"
        )

    return {
        "ok": True
    }


# ---------------------------------------------------------------------------
# Worries + comments
# ---------------------------------------------------------------------------
@api_router.get("/worries")
async def list_worries(
    x_user_id: Optional[str] = Header(None),
):
    user = await get_user(
        x_user_id
    )

    cur = (
        db.worries.find(
            {
                "couple_id":
                    user["couple_id"],
                "deleted_at": None,
            }
        )
        .sort(
            "created_at",
            -1,
        )
    )

    worries = await cur.to_list(500)

    out = []

    for w in worries:
        comments = await (
            db.comments.find(
                {
                    "worry_id":
                        w["id"],
                    "deleted_at":
                        None,
                }
            )
            .sort(
                "created_at",
                1,
            )
            .to_list(500)
        )

        out.append(
            {
                "id":
                    w["id"],
                "text":
                    w["text"],
                "author_id":
                    w["author_id"],
                "author_name":
                    w["author_name"],
                "is_mine":
                    w["author_id"]
                    == user["id"],
                "created_at":
                    w["created_at"],
                "comments": [
                    {
                        "id":
                            c["id"],
                        "text":
                            c["text"],
                        "author_id":
                            c["author_id"],
                        "author_name":
                            c["author_name"],
                        "is_mine":
                            c["author_id"]
                            == user["id"],
                        "created_at":
                            c["created_at"],
                    }
                    for c in comments
                ],
            }
        )

    return out


@api_router.post("/worries")
async def create_worry(
    body: WorryIn,
    x_user_id: Optional[str] = Header(None),
):
    user = await get_user(
        x_user_id
    )

    text = body.text.strip()

    if not text:
        raise HTTPException(
            status_code=400,
            detail="Empty worry",
        )

    w = {
        "id": str(uuid.uuid4()),
        "couple_id":
            user["couple_id"],
        "author_id":
            user["id"],
        "author_name":
            user["name"],
        "text":
            text,
        "created_at":
            now_iso(),
        "deleted_at":
            None,
    }

    await db.worries.insert_one(w)

    try:
        recipients = await partner_user_ids(
            user["couple_id"],
            user["id"],
        )

        await send_push(
            recipients=recipients,
            data={
                "title":
                    f"💭 {user['name']} shared a worry",
                "message":
                    text[:140],
                "action_url":
                    "/(tabs)/worries",
            },
        )

    except Exception as e:
        logger.warning(
            f"Push failed (non-blocking): {e}"
        )

    return {
        "id": w["id"]
    }


@api_router.post(
    "/worries/{worry_id}/comments"
)
async def add_comment(
    worry_id: str,
    body: CommentIn,
    x_user_id: Optional[str] = Header(None),
):
    user = await get_user(
        x_user_id
    )

    w = await db.worries.find_one(
        {
            "id": worry_id,
            "couple_id":
                user["couple_id"],
            "deleted_at": None,
        }
    )

    if not w:
        raise HTTPException(
            status_code=404,
            detail="Worry not found",
        )

    text = body.text.strip()

    if not text:
        raise HTTPException(
            status_code=400,
            detail="Empty comment",
        )

    c = {
        "id": str(uuid.uuid4()),
        "worry_id":
            worry_id,
        "couple_id":
            user["couple_id"],
        "author_id":
            user["id"],
        "author_name":
            user["name"],
        "text":
            text,
        "created_at":
            now_iso(),
        "deleted_at":
            None,
    }

    await db.comments.insert_one(c)

    try:
        recipients = await partner_user_ids(
            user["couple_id"],
            user["id"],
        )

        await send_push(
            recipients=recipients,
            data={
                "title":
                    f"💬 {user['name']} commented",
                "message":
                    text[:140],
                "action_url":
                    f"/worry/{worry_id}",
            },
        )

    except Exception as e:
        logger.warning(
            f"Push failed (non-blocking): {e}"
        )

    return {
        "id": c["id"]
    }


# ---------------------------------------------------------------------------
# Shared calendar / events
# ---------------------------------------------------------------------------
def event_public(
    e,
    me_id,
):
    return {
        "id":
            e["id"],
        "title":
            e["title"],
        "note":
            e.get("note", ""),
        "event_date":
            e["event_date"],
        "author_id":
            e["author_id"],
        "author_name":
            e["author_name"],
        "is_mine":
            e["author_id"]
            == me_id,
        "created_at":
            e.get("created_at"),
    }


@api_router.get("/events")
async def list_events(
    x_user_id: Optional[str] = Header(None),
):
    user = await get_user(
        x_user_id
    )

    today = uk_today()

    cur = (
        db.events.find(
            {
                "couple_id":
                    user["couple_id"],
                "deleted_at": None,
            }
        )
        .sort(
            "event_date",
            1,
        )
    )

    events = await cur.to_list(
        1000
    )

    out = []

    for e in events:
        if e["event_date"] < today:
            await db.events.update_one(
                {
                    "id":
                        e["id"]
                },
                {
                    "$set": {
                        "deleted_at":
                            now_iso()
                    }
                },
            )

            continue

        out.append(
            event_public(
                e,
                user["id"],
            )
        )

    return out


@api_router.post("/events")
async def create_event(
    body: EventIn,
    x_user_id: Optional[str] = Header(None),
):
    user = await get_user(
        x_user_id
    )

    title = body.title.strip()

    event_date = (
        body.event_date or ""
    ).strip()

    if not title:
        raise HTTPException(
            status_code=400,
            detail="Title is required",
        )

    try:
        datetime.strptime(
            event_date,
            "%Y-%m-%d",
        )

    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=(
                "event_date must be YYYY-MM-DD"
            ),
        )

    if event_date < uk_today():
        raise HTTPException(
            status_code=400,
            detail=(
                "Cannot add an event "
                "in the past"
            ),
        )

    e = {
        "id":
            str(uuid.uuid4()),
        "couple_id":
            user["couple_id"],
        "author_id":
            user["id"],
        "author_name":
            user["name"],
        "title":
            title,
        "note":
            (body.note or "").strip(),
        "event_date":
            event_date,
        "created_at":
            now_iso(),
        "deleted_at":
            None,
    }

    await db.events.insert_one(e)

    try:
        recipients = await partner_user_ids(
            user["couple_id"],
            user["id"],
        )

        await send_push(
            recipients=recipients,
            data={
                "title":
                    f"📅 {user['name']} added an event",
                "message":
                    title[:140],
                "action_url":
                    "/(tabs)/calendar",
            },
        )

    except Exception as ex:
        logger.warning(
            f"Push failed (non-blocking): {ex}"
        )

    return event_public(
        e,
        user["id"],
    )


@api_router.delete(
    "/events/{event_id}"
)
async def delete_event(
    event_id: str,
    x_user_id: Optional[str] = Header(None),
):
    user = await get_user(
        x_user_id
    )

    e = await db.events.find_one(
        {
            "id":
                event_id,
            "couple_id":
                user["couple_id"],
            "deleted_at":
                None,
        }
    )

    if not e:
        raise HTTPException(
            status_code=404,
            detail="Not found",
        )

    if (
        e["author_id"]
        != user["id"]
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "Only the author can "
                "delete this event"
            ),
        )

    await db.events.update_one(
        {
            "id":
                event_id
        },
        {
            "$set": {
                "deleted_at":
                    now_iso()
            }
        },
    )

    return {
        "ok": True
    }


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app.include_router(
    api_router
)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    try:
        await run_in_threadpool(
            init_storage
        )

        logger.info(
            "Object storage initialised"
        )

    except Exception as e:
        logger.error(
            f"Storage init failed: {e}"
        )


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
