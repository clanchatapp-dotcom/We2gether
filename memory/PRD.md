# 2gether (We2gether) — PRD

## Original problem statement
User reported "Invalid URL: /api/couples/create" and could not log in. Their real app
(`clanchatapp-dotcom/We2gether`) had a working design; the login only failed because the
old published backend URL was no longer reachable. Task: bring the app into a live workspace
so login works again, keeping the design exactly the same.

## Resolution (2026-09-19)
- Ported the full We2gether repo (frontend + FastAPI backend + MongoDB) into this Emergent
  workspace, which provides a live backend + database.
- Frontend API client (`src/api.ts`) already uses an absolute URL:
  `process.env.EXPO_PUBLIC_BACKEND_URL + "/api" + path` — no relative-URL bug.
- `EXPO_PUBLIC_BACKEND_URL` now points to this workspace's live preview backend.
- Backend `.env` set with `EMERGENT_LLM_KEY` (object storage) and `EMERGENT_PUSH_KEY`
  (placeholder, auto-filled on deploy).
- Added an auth-`ready` gate in `app/_layout.tsx` so no screen fires an authed request
  before the stored `X-User-Id` is loaded (removes transient 401s on cold deep-links).
- Verified: create space, join by code, /couples/me, moods, chat text, worries+comments,
  gallery. Backend pytest 15/15 pass; frontend login flow confirmed via UI.

## Architecture
- Frontend: Expo Router (SDK 57), react-query, react-native-keyboard-controller,
  @gorhom/bottom-sheet, expo-image/-video/-image-picker/-notifications, Feather icons.
- Auth: display-name only (no password). Create/join returns `user_id`, stored in SecureStore
  as `g2g_user_id`, sent as `X-User-Id` header. No JWT.
- Backend: FastAPI, `APIRouter(prefix="/api")`, Motor/MongoDB, Emergent object storage for
  media, Emergent push relay. Soft deletes via `deleted_at`.
- Navigation: tabs = Us (home), Chat, Gallery, Worries; + onboarding, worry/[id]. iOS 26+
  uses NativeTabs, else JS Tabs.

## Core requirements (static)
- Two partners share one private space, paired by a 6-char code.
- Daily moods (reset at UK midnight), shared chat (text + photo/video incl. one-time & no-save),
  photo gallery, shared worries with comments.

## Data models (Mongo, all soft-deleted)
couples(id, code, since_date, members[{user_id,name}]), users(id,name,couple_id),
messages(text/media, privacy, consumed), moods(per user per UK date), worries, comments.

## Implemented (2026-09-19)
- Full app ported and login/pairing verified end-to-end. All core flows working.

## Backlog / next
- P1: Push works only after deploy + native build with the user's own google-services.json.
- P2: Consider splitting server.py into routers; optional "sign out" confirmation.
