#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Continuation task on the 2gether (We2gether) couples app. Build 3 features following
  existing conventions (couple_id scoping, soft-delete via deleted_at, uuid ids, now_iso(),
  message_public()-style shaping, send_push + partner_user_ids, react-query, makeStyles, testID):
  1) Shared Calendar (new events collection + /api/events GET/POST/DELETE, new Calendar tab).
  2) Read receipts for messages AND photos (read_at + POST /api/messages/read, focus-only marking).
  3) Harden screenshot protection on one_time/no_save media (blocking Alert in MediaViewer).
  Plus pytest coverage for /api/events and /api/messages/read.
  NOTE: backend/.env and frontend/.env were missing in this workspace (gitignored) and were
  recreated (MONGO_URL, DB_NAME, EMERGENT_LLM_KEY, EMERGENT_PUSH_KEY placeholder; EXPO_PUBLIC_BACKEND_URL).

backend:
  - task: "Shared calendar events API (GET/POST/DELETE /api/events with UK-midnight expiry self-heal)"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Added events collection endpoints. GET filters event_date >= uk_today() and soft-deletes any expired event on first touch (self-heal). POST validates YYYY-MM-DD + rejects past dates, push-notifies partner. DELETE is author-only (403 otherwise). Returns author_name + is_mine. Verified via curl + local pytest (15/15)."
        -working: true
        -agent: "testing"
        -comment: "PASSED all tests. Verified: (1) POST /api/events creates events with title/note/event_date, returns author_name and is_mine=true; (2) Validation works - rejects empty title (400), past dates (400), malformed dates like '27-01-2027' (400); (3) GET /api/events requires auth (401), returns events sorted by event_date asc, shows correct author_name and is_mine for both author and partner; (4) EXPIRY SELF-HEAL verified - inserted past event directly into MongoDB, confirmed it was filtered from GET response AND soft-deleted (deleted_at set); (5) DELETE is author-only - partner gets 403, author gets 200, event removed from list; (6) DELETE unknown event returns 404. All 10 manual tests + 9 pytest tests passed."
  - task: "Read receipts: read_at field + POST /api/messages/read + message_public output"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "read_at added to message_public. POST /messages/read accepts {through_id} or {message_ids}, only stamps partner's (sender != me) unread messages, never overwrites, independent of one_time consumed flag. Verified via curl + local pytest."
        -working: true
        -agent: "testing"
        -comment: "PASSED all tests. Verified: (1) POST /api/messages/read with through_id marks all partner's messages up to that point (marked 3+ messages); (2) POST with message_ids marks specific messages; (3) Sender's own messages are NOT marked (marked=0 when sender calls it); (4) Unknown through_id returns 404; (5) Requires auth (401 without X-User-Id); (6) CRITICAL: read_at is INDEPENDENT of one_time consumption - uploaded one_time media, marked as read, verified read_at set BUT consumed=False and can_open=True, then successfully opened it (consumed=True after open). All 6 manual tests + 6 pytest tests passed."
  - task: "Screenshot report endpoint (baseline, unchanged) POST /api/messages/{id}/screenshot"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Baseline endpoint applied from uploaded artifact; no logic change this task."
        -working: true
        -agent: "testing"
        -comment: "Endpoint exists and is unchanged. No testing required as per main agent."

frontend:
  - task: "Calendar tab (new app/(tabs)/calendar.tsx) + tab registered in both layouts"
    implemented: true
    working: "NA"
    file: "frontend/app/(tabs)/calendar.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Agenda list grouped by day, each card shows title/note + 'added by {author_name}', author-only delete. Add-event sheet with title/note/horizontal date strip. Tab added to NativeTabs + JsTabs (calendar icon). NOT yet UI-tested (awaiting user permission)."
  - task: "Read receipts UI in chat + gallery (focus-only mark read, Read {time} label, Seen badge)"
    implemented: true
    working: "NA"
    file: "frontend/app/(tabs)/chat.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Marks read only when screen focused (useFocusEffect) AND app active (AppState) — not from 4s poll. 'Read HH:mm' under last read own message; 'Seen' badge on own media in chat + gallery. NOT yet UI-tested."
  - task: "Harden screenshot protection: blocking Alert in MediaViewer (shared chat+gallery)"
    implemented: true
    working: "NA"
    file: "frontend/src/components/MediaViewer.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: "Replaced toast with blocking Alert.alert on screenshot-detected (iOS detect+notify; Android FLAG_SECURE prevents). Capture key scoped, released on close — no leak between chat/gallery. NOT yet UI-tested."

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 1
  run_ui: false

test_plan:
  current_focus:
    - "Shared calendar events API (GET/POST/DELETE /api/events with UK-midnight expiry self-heal)"
    - "Read receipts: read_at field + POST /api/messages/read + message_public output"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    -agent: "main"
    -message: "Please test the new backend endpoints: (1) /api/events create/list/delete incl. author-only delete (403 for partner) and expiry self-heal (a past-dated event inserted directly into Mongo must be filtered out AND soft-deleted on first GET); (2) /api/messages/read via through_id and message_ids, ensuring only the partner's messages get read_at, sender's own are untouched, and one_time consumed is unaffected. New pytest file: backend/tests/test_events_and_read.py. Existing flows must still pass. NOTE: .env files were recreated this session."
    -agent: "testing"
    -message: "✅ BACKEND TESTING COMPLETE - ALL TESTS PASSED. Executed comprehensive testing: (1) Full pytest suite: 38/38 tests passed (test_2gether_flows.py, test_events_and_read.py, test_put_object_selfheal.py); (2) Manual API testing via backend_test.py: 21/21 tests passed covering all scenarios in review request including EXPIRY SELF-HEAL (verified past event inserted into MongoDB was filtered and soft-deleted) and READ RECEIPT INDEPENDENCE from one_time consumption. (3) Regression testing: verified text messages, moods, worries, media upload, and gallery all working. Both new features (shared calendar + read receipts) are fully functional with all edge cases handled correctly. No issues found."