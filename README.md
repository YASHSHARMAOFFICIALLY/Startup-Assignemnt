# Alcovia — Offline-First Focus & Syllabus Sync

Take-home for the Full Stack Engineering Intern role. Two features — **focus
sessions** and **syllabus progress** — built offline-first, with a backend that
keeps multiple devices in sync (own sync/merge logic, no off-the-shelf sync
product) and an n8n automation that notifies on successful sessions **exactly
once**.

See **[DECISIONS.md](DECISIONS.md)** for the sync model, conflict resolution and
idempotency reasoning. See **[PLAN.md](PLAN.md)** for how the work was broken
into sessions.

```
shared/   the sync core: event types, hybrid logical clock, reducer (used by BOTH app & server)
server/   Express backend: event log + /sync protocol + n8n trigger + mock notification sink
app/      Expo (React Native) client: focus timer, syllabus, dev panel, offline sync engine
n8n-workflow.json   the automation, exported, importable into a fresh n8n
```

## How to run

Prereqs: Node 20+ (tested on 22), npm.

### 1. Backend

```bash
cd server
npm install
npm run dev          # http://localhost:4000, state persisted to server/data/db.json
```

### 2. App (web, two "devices")

```bash
cd app
npm install
npm run web          # opens http://localhost:8081
```

Open **two browser tabs**:

- `http://localhost:8081/?client=A`
- `http://localhost:8081/?client=B`

Each `client` value gets its own storage namespace, so the tabs behave like two
real devices on one account (hardcoded `student-1`). For an actual phone, run
`npx expo start` and open in Expo Go with
`EXPO_PUBLIC_SERVER_URL=http://<your-lan-ip>:4000` set.

### 3. n8n

```bash
npx n8n              # http://localhost:5678
```

In the n8n UI: **Workflows → Import from File → `n8n-workflow.json`**, open it,
then **Activate** the workflow (important: the idempotency guard uses workflow
static data, which only persists for active workflows — "Test workflow" runs
start with fresh static data).

The backend posts to `http://localhost:5678/webhook/focus-session-success`
(override with `N8N_WEBHOOK_URL`). The workflow delivers the notification to the
backend's **mock sink** (`POST /notification-sink`) — a stand-in for WhatsApp,
as the brief allows — and the app's dev panel displays the sink live. If your
n8n runs in Docker, change the sink URL in the HTTP Request node to
`http://host.docker.internal:4000/notification-sink`.

### Tests (including the convergence fuzz test)

```bash
cd server
npm test             # reducer/HLC unit tests + randomized multi-device convergence + exactly-once webhook
npm run typecheck
```

## The demo script (what the video shows)

1. Tab A and Tab B open, both online, dev panels visible.
2. Toggle **both offline** in the dev panels.
3. On **A**: run a focus session ("Demo: 10 s") to success → streak/coins update
   instantly, offline. On **B**: run one too, and **give up** a second one.
4. Conflicting edit: on A set *Linear equations worksheet* → **Done**; on B set
   the same task → **In progress**. (Also: delete a task on A that B edits.)
5. Outboxes show queued events. Toggle **A online** → it syncs; toggle **B
   online** → both converge to the identical state (compare "Show local state").
6. The dev panel's notification sink shows **one entry per successful session**
   — even though each session's completion event was replayed and pulled by the
   other device, and the same task edits arrived from both sides.
7. Kill and restart the server (`npm run dev`) — state survives, nothing
   re-fires.

## What the core handles

- **Offline-first**: every action applies instantly to local state and a durable
  outbox (AsyncStorage / localStorage); the network is never on the critical
  path. Restart mid-queue and the outbox survives.
- **Two devices converge**: identical state on both after reconnect — see
  DECISIONS.md for why, and `server/test/convergence.test.ts` for the proof.
- **Idempotent rewards**: coins/streak/today-total are derived from the set of
  completed sessions, so replays and double-device arrivals can't double-count.
- **Idempotent automation**: backend fires once per session ever (persisted
  claim), n8n dedupes again on `sessionId` in case a crash forces a redelivery.
- **Conflicts, deliberately**: HLC last-writer-wins for status edits
  (clock-skew-proof), delete-wins for edit-vs-delete (shown as a tombstone, not
  silently), eventId dedupe + terminal-beats-running for replayed/out-of-order
  messages.
- **Demonstrable**: per-client dev panel with online/offline toggle, force sync,
  outbox/cursor inspection, full state dump, and live notification-sink view.

## Choices the brief left open (noted as required)

- **Grace period**: 5 s hidden/backgrounded → session fails (`app_switch`).
- **Restart mid-session**: counts as `app_switch` failure (the student left the
  app; allowing resume would make backgrounding undetectable on web).
- **Coins**: 1 coin per target minute (50-min session = +50), min 1.
- **Streak**: consecutive calendar days with ≥1 successful session, counted back
  from today; a day with no success *yet* doesn't break yesterday's streak.
- **Schema/copy**: hardcoded seed syllabus (2 subjects × 2 chapters × 2–3
  tasks); statuses cycle Not started → In progress → Done on tap; long-press
  deletes.
- **Notification target**: mock sink endpoint (allowed by the brief); swapping
  the HTTP Request node for a WhatsApp provider node changes nothing about the
  idempotency story.

## Beyond core (from the optional list)

- **Property/fuzz test**: randomized offline edit sequences across **3 devices**
  with skewed clocks and replayed deliveries always converge (30 seeded runs).
- **Works with 3+ devices**: nothing in the protocol is two-device-specific
  (the fuzz test runs three).
- **Survives app restart / crash mid-session**: state + outbox persist; an
  interrupted focus session is detected and failed on next boot.
- **Resumes safely mid-sync**: the cursor only advances after a successful
  apply+persist; a dropped response just means the next round re-pulls
  (idempotently).

## What I left out / would do next

- **Two-way loop** (reply "done/snooze" from the notification → n8n webhook →
  backend event): the event pipeline already supports it — it's one more event
  type plus an n8n webhook node.
- **Log compaction / snapshotting** so new devices don't replay full history
  (the tradeoff discussed in DECISIONS.md).
- **Per-user timezone** for day boundaries; currently device-local.
- **SQLite on device** instead of a single AsyncStorage document; transactional
  appends.
- **Surfacing conflicts to the user** when an auto-merge isn't obviously right
  (e.g. a toast: "Laptop changed this task too — kept the newer edit").
- Auth, multiple students, real WhatsApp delivery.
