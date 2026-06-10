# Build Plan — Alcovia Full Stack Intern Assignment

Offline-first focus sessions + syllabus progress, multi-device sync (own sync logic),
and an idempotent n8n automation. Stack: TypeScript, React Native (Expo, web OK),
Express, n8n.

The work is broken into small sessions. Each session ends with a commit that leaves
the repo in a working state.

---

## Session 0 — Repo + plan (this commit)
- [x] Scaffold Expo TypeScript app (`app/`)
- [x] Write this PLAN.md

## Session 1 — Shared core: types, HLC, reducer
**Goal: one deterministic merge core used by BOTH app and server (`shared/`).**
- [x] Domain types: `FocusSession`, `Subject/Chapter/Task`, `Event` envelope
      (`eventId`, `studentId`, `deviceId`, `hlc`, `type`, `payload`)
- [x] Hybrid Logical Clock (HLC): sortable string, send/receive update rules
      (no wall-clock LWW — device clocks disagree)
- [x] Pure reducer: `state = fold(events)` that is **order-insensitive and
      duplicate-insensitive** (LWW registers keyed by HLC for task status,
      id-keyed maps for sessions, delete = tombstone-wins)
- [x] Derived rewards: coins, focus streak, today's focus total — computed from the
      set of successful sessions, so replays can never double-count

## Session 2 — Express backend with sync protocol
**Goal: server that keeps devices in sync and is idempotent end-to-end.**
- [x] `POST /sync`: accept client outbox events (dedupe by `eventId`), assign global
      `seq`, return all events after the client's cursor
- [x] JSON-file persistence (survives restart)
- [x] On *first* application of a `session_completed` event: fire webhook to n8n
      exactly once (dedupe on `sessionId`, persisted)
- [x] Mock notification sink: `POST /notification-sink` + `GET /notifications`
      so the app's dev panel can show notifications firing exactly once
- [x] Debug endpoint `GET /state/:studentId`

## Session 3 — Convergence + idempotency tests
**Goal: prove the merge logic, don't just claim it.**
- [x] Unit tests: HLC ordering, reducer rules (conflicting task edits, edit-vs-delete,
      duplicate/out-of-order events)
- [x] Fuzz/property test: many random offline edit sequences across 2–3 simulated
      devices, random sync order, replayed messages → states always converge,
      rewards counted exactly once, webhook fired exactly once per success

## Session 4 — App: offline-first storage + sync client
**Goal: every action works instantly offline and survives restart.**
- [x] Per-client storage namespace (`?client=A` / `?client=B` on web) so two tabs
      behave like two real devices
- [x] Durable local store: event log + outbox in AsyncStorage/localStorage
- [x] Sync engine: apply local events optimistically, push outbox + pull on a poll
      loop, dedupe, recompute state via the shared reducer
- [x] Manual online/offline switch that actually blocks network calls

## Session 5 — App: Feature A (focus sessions)
- [x] Start session with target duration, live countdown
- [x] Success when full duration elapses in-session
- [x] Fail on **Give up** or on backgrounding/hiding the app past a 5 s grace period
- [x] Restart mid-session = fail (`app_switch`) — deliberate rule, documented
- [x] Rewards visible immediately offline (streak, coins, today's total)

## Session 6 — App: Feature B (syllabus progress)
- [x] Seeded subjects → chapters → tasks
- [x] Tap to change status (Not started → In progress → Done), works offline
- [x] Chapter % = done tasks ÷ total; subject % rolls up; updates instantly
- [x] Task delete (to demonstrate the edit-vs-delete conflict)

## Session 7 — Dev panel (Requirement 6: demonstrable)
- [x] Online/offline toggle per client, force-sync button
- [x] Show: device id, outbox size, last sync, event count, current state
- [x] Live list of notifications received by the sink — shows n8n firing exactly once

## Session 8 — Feature C: n8n workflow
- [x] Webhook trigger → idempotency guard (workflow static data keyed by
      `sessionId`) → build message "Streak now N days, +X coins" → HTTP request to
      the mock sink → respond
- [x] Export as `n8n-workflow.json`, importable into a fresh n8n

## Session 9 — Docs + polish
- [x] `README.md`: how to run app/backend, how to import + run the n8n workflow,
      conflict cases handled, what was left out, what I'd do next
- [x] `DECISIONS.md`: data/sync model, conflict resolution, why two devices always
      converge, how idempotency is enforced in backend **and** n8n, one tradeoff
- [x] Final end-to-end pass of the demo script (two clients diverge offline →
      reconnect → reconcile; notification fires once)

## Not automatable here
- The 5-minute demo video must be recorded manually (script for it goes in README).
