# DECISIONS.md

## The data / sync model in one paragraph

Every user action — start/finish/fail a focus session, change or delete a task —
is an immutable **event** with a client-generated UUID (`eventId`), the device
that produced it, and a **hybrid logical clock (HLC)** timestamp. Events are the
only thing that syncs. Each device applies its own events to local state
instantly and appends them to a durable **outbox**; a background loop pushes the
outbox to `POST /sync` and pulls every event it hasn't seen yet (tracked by a
per-device **cursor** over the server's global sequence). The server is an
append-only event log: it dedupes incoming events by `eventId`, assigns each new
event a global `seq`, and rebuilds its own state by folding the log. App and
server fold events through the **same reducer** (`shared/src/reducer.ts`), so
there is exactly one definition of what the state means.

```
device A ──events──▶                       ◀──events── device B
   ▲                 \                    /                ▲
   └── local fold     ▶  server log (seq) ◀     local fold ┘
                          dedupe by eventId
                          fold with the SAME reducer
```

## Why two devices always end up identical

Convergence does not depend on message order or on how many times a message
arrives. The reducer is built so that the resulting state is a pure function of
the **set** of events seen, because every piece of state is one of:

1. **An id-keyed record** (sessions keyed by `sessionId`). Replays and the same
   session arriving from both devices collapse into one record.
2. **A last-writer-wins register ordered by HLC** (task status, session terminal
   status). `a.hlc > b.hlc` is a total order — HLC strings encode
   `(physical, counter, deviceId)`, and the deviceId suffix breaks exact ties
   deterministically. Applying writes in any order yields the same winner.
3. **A grow-only tombstone** (task deletion). Once deleted, always deleted, and
   the tombstone record is canonical (it never carries leftover status fields),
   so it cannot encode arrival order.

Both devices eventually receive the full event set (each pull returns
everything after the device's cursor), and identical event sets + an
order-insensitive, duplicate-insensitive fold ⇒ identical state. The server
holds the same set, so it agrees too. This is property-tested:
`server/test/convergence.test.ts` runs randomized offline edit sequences across
3 simulated devices with skewed clocks, random sync order and deliberately
replayed messages, and asserts byte-identical states every run.

## Conflict resolution, case by case

- **Same task's status changed on both devices** (phone → Done, laptop → In
  progress): per-task LWW on HLC. The edit with the higher HLC wins on every
  replica. HLCs advance with causality (receiving an event pulls your clock
  forward), so "later" means *causally later where causality exists*, and a
  deterministic tiebreak where it doesn't. Wall-clock LWW was rejected
  explicitly: device clocks disagree (the fuzz test skews them ±5 min to prove
  this doesn't matter).
- **Task edited on one device, deleted on the other**: **delete wins**, even if
  the edit has a later HLC. Rationale: a resurrected task that the student
  believes is gone is more confusing than a lost status flip on a task they
  chose to remove. The deleted task stays visible as a struck-through tombstone
  so nothing disappears silently.
- **Same sync message arriving twice, or out of order**: dedupe by `eventId`
  (in the reducer and on the server) makes duplicates no-ops; HLC-based LWW
  makes ordering irrelevant. A late-arriving `session_started` can never
  resurrect a session that already completed/failed (terminal beats running).

## Why rewards are idempotent (counted exactly once)

Coins, streak and today's focus total are **never stored — always derived** from
the set of *completed* session records. A session completed offline, replayed
during sync, or arriving from both devices is still just one record in an
id-keyed map, so it can only contribute once. There is no `coins += x` anywhere
that a replay could re-execute.

## How idempotency reaches n8n (end to end)

1. **App → server**: outbox retries can deliver the same event many times; the
   server drops known `eventId`s, so the log gains the event once.
2. **Server → n8n trigger**: the server fires the webhook only when a session
   transitions to `completed` *for the first time in the log's history*, and
   records the `sessionId` in a persisted `notified` map (`pending` → `sent`).
   Replays, the second device's copy of the same session, and server restarts
   (the log is refolded on boot) can't re-trigger it.
3. **The unavoidable gap**: exactly-once *HTTP delivery* is impossible — the
   server can crash after n8n received the call but before recording `sent`,
   and the boot-time retry of `pending` entries would then deliver a duplicate.
4. **n8n closes the gap**: the workflow's first node after the webhook is an
   idempotency guard that dedupes on `sessionId` in workflow static data and
   routes duplicates to a no-op branch. Dedupe is on a **stable event id, never
   wall-clock time**.

So the layering is: at-least-once delivery + dedupe-by-stable-id at every
consumer = exactly-once *effect*.

## One tradeoff I made deliberately

**Full-state pull simplicity over efficient sync.** A device that falls behind
pulls *all* events after its cursor, and the server keeps the entire event log
forever (no compaction). For a study app's data volume (tens of events per
student per day) this is the right cost: the protocol is one idempotent
endpoint, resumable after any interruption (the cursor only advances after a
successful apply+persist), and trivially debuggable — at the price of unbounded
log growth and re-sending history to brand-new devices. Compaction (snapshot +
log suffix) is the known fix and is listed under "what I'd do next" in the
README. A related accepted cost: `appliedEventIds` grows with the log; same
remedy.

## Where it could still break (honesty section)

- **Streak day boundaries use each device's local timezone** to compute
  `dayKey`. Two devices in different timezones could disagree about which day a
  session belongs to. Fix: store the student's home timezone server-side.
- **Static data in n8n** persists only for an *active* workflow; in "Test
  workflow" mode every run starts fresh, so duplicates are only filtered by the
  backend layer there.
- **AsyncStorage writes are not transactional** with React state updates; a
  crash in the same millisecond as an emit could lose that one event (the
  outbox write is awaited, but the window exists). A WAL-style append file (or
  SQLite) would close it.
- **No auth** (per the brief): anyone who can reach the server can write events.
