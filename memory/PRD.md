# 2gether (We2gether) — PRD

## Original problem statement
User (UK) with partner in Moscow asked to rebuild their existing We2gether couples app
in this workspace and fix 4 issues, keeping the app otherwise identical:
1. Calendar must run on UK time so both partners see the same "today".
2. Media send: GIFs and videos failed to send entirely (only photos worked).
3. Read receipts didn't show "received" or "read".
4. Notifications setup verified.

## Architecture
- Frontend: Expo Router (SDK 57), react-query, react-native-keyboard-controller,
  @gorhom/bottom-sheet, expo-image/-video/-image-picker/-notifications, Feather icons.
- Auth: display-name only (no password). Create/join returns `user_id`, stored in
  SecureStore as `g2g_user_id`, sent as `X-User-Id` header.
- Backend: FastAPI `APIRouter(prefix="/api")`, Motor/MongoDB, Emergent object storage
  for media, Emergent push relay. Soft deletes via `deleted_at`. UK time via
  `ZoneInfo("Europe/London")`.
- Tabs: Us (home), Chat, Gallery, Calendar, Worries. iOS 26+ NativeTabs, else JS Tabs.

## Core requirements (static)
- Two partners share one private space, paired by a 6-char code.
- Daily moods (reset at UK midnight), shared chat (text + photo/video/GIF incl.
  one-time & no-save), photo gallery, shared worries with comments, shared calendar.

## Fixes implemented (2026-06)
- **Media (GIF + video send):** `src/api.ts` `uploadMedia` now streams the file off
  disk on native via `expo-file-system` `File.upload` (MULTIPART) instead of the old
  Blob + global-fetch path that silently failed for videos/GIFs while small JPEGs
  slipped through. Correct MIME/extension inferred (image/gif, video/mp4, …). Library
  picks no longer re-encode, preserving animated GIFs. Web keeps FormData+blob.
- **Read receipts:** added backend `delivered_at` — `GET /api/messages` stamps the
  partner's messages delivered on fetch; `message_public` returns it. Chat shows a
  status line under the newest of my messages: Sent → Delivered → Read HH:mm (UK time).
- **Calendar UK time:** new `src/uk-date.ts` anchors the date strip and day labels to
  Europe/London via Intl, so both partners align regardless of phone timezone. Backend
  already validated/expired events on UK date.
- **Notifications:** `/api/register-push` wired and verified; works after deploy +
  native build with the user's own `google-services.json`.

## Verification (2026-06)
- Backend 14/14 pytest pass (media jpg/gif/mp4, delivered→read transitions, UK event
  rules, register-push, regression). Frontend web smoke test clean (onboarding, chat
  send + "Sent" receipt, calendar). No blocking issues.

## Features added (2026-06, session 2)
- **Typing indicator:** backend `POST /api/typing` (throttled ping) + `GET /api/typing`
  → `{partner_typing}` (true only if the OTHER member pinged within ~6s). Chat shows an
  animated three-dot bubble (`src/components/TypingDots.tsx`, testID=typing-indicator)
  above the input while the partner types. Polls every 2.5s.
- **Editable anniversary date:** couple gains `anniversary_date` (falls back to since_date).
  `POST /api/couples/anniversary {date}` (future rejected). Home "together since" block is
  tappable (testID=anniversary-btn) → `AnniversarySheet` Month/Day/Year chip picker; date
  shown as "15 June 2020" and "X days of us" recalculated from it. All in the existing theme.
- Verified: backend 21/21 pytest, frontend both flows + full regression green.

## CI / installable APK build (2026-06, session 3)
- Restored the full We2gether app into this workspace (it had been reset to a blank
  Emergent starter). Preserved Emergent-protected env files (frontend/.env packager
  vars, backend/.env MONGO_URL/DB_NAME); added EMERGENT_LLM_KEY + EMERGENT_PUSH_KEY.
- Fixed `.github/workflows/Android-apk.yml` (was broken):
  - Committed a real `frontend/yarn.lock` so `yarn install --frozen-lockfile` works
    (previously no lockfile → CI failed immediately).
  - Bakes `EXPO_PUBLIC_BACKEND_URL` (default https://we2gether.onrender.com, overridable
    via workflow_dispatch input) into the JS bundle — verified inlined in an export.
  - Builds `assembleRelease` → self-contained `app-release.apk` (JS embedded, signed with
    the auto debug keystore) so it installs on any phone without Metro. Uploads as the
    `We2gether-apk` artifact. Added android-actions/setup-android + gradle cache + chmod
    of guard scripts for CI robustness.
  - Ignored generated `/android` and `/ios` (CNG regenerates them in CI).
- Verified: app renders in preview, backend healthy + object storage init, prebuild OK,
  frozen-lockfile OK, backend URL confirmed inlined into the bundle. gradle assembleRelease
  itself runs on GitHub's x86 runner (no Android SDK / working Hermes in this container).

## Session 4 (2026-06): auto-build on push + backend health banner
- **Auto APK on push:** `.github/workflows/Android-apk.yml` now triggers on `push` to
  `main`/`master` (plus the existing manual `workflow_dispatch`), so every push produces a
  fresh `We2gether-apk` artifact. `concurrency` cancels superseded runs.
- **Backend health warning:** `src/components/BackendHealth.tsx` (mounted in `_layout`)
  pings `GET /api/` via new `pingBackend()` in `src/api.ts` on launch and on every
  foreground. Silent when reachable; if the Render backend is asleep/unreachable it shows a
  themed warning banner ("Can't reach the server — it may be waking up. Retrying…") with a
  Retry button, retries every 4s, and auto-hides the moment the server responds. 25s ping
  timeout to tolerate Render cold starts. testIDs: backend-health-banner/-text/-retry.
- Verified: banner absent when backend up (no false alarm), renders correctly when down;
  lint clean, workflow YAML valid.

## Backlog / next
- P1: Push only works after deploy + native build with the user's google-services.json.
- P1: For a signed/publishable APK, replace the debug keystore with a real release keystore.
- P2: Consider splitting server.py into feature routers as the app grows.
