# Mistake Training — Tappe 1 e 2

Tappa 1 SQL and catalog were applied successfully to Supabase, as confirmed by
the project owner. Tappa 2 adds `mistake-training.html` and the Practice hook;
the additional Practice enrollment migration was also applied successfully, as
confirmed by the project owner on 2026-11-06. These migrations must not be rerun.
No changes to Notes, History, Analytics, Practice counters or question banks.

## Migration order (reference for fresh environments)

Apply `docs/migrations/20261106_mistake_training.sql`, then
`docs/migrations/20261106_mistake_training_catalog.sql`, as the database owner.
The second file is reproducible with `node scripts/mistake-training/catalog.js`.
It contains 5,299 distinct main identities, revisions, answer counts and original
correct indices; no question text or Past Papers. Treat it as a private grading
catalog. Do not expose the schema through PostgREST or grant client access.
Both files use transactions and fail rather than overwrite an existing setup.
No command here connects to Supabase.

## Client usage

Load `mistake-training.js` explicitly when integrating a training page:

```js
const training = MistakeTraining.createClient(supabaseClient);
const existing = await training.active(1);
// Resume existing.id when present. Otherwise persist a UUID locally BEFORE start.
const sessionId = crypto.randomUUID();
await training.start(1, sessionId, canonicalQuestionIds); // 5–50 unique main IDs
await training.resume(1, sessionId);
await training.answer(1, sessionId, 'main:891', originalAnswerIndex);
await training.finalize(1, sessionId);
const progress = await training.progress(1);
```

The caller resolves legacy mistakes with QuestionIdentity before selection and
must discard excluded/unresolved/ambiguous/retired results. This engine accepts
only registered canonical main IDs in the explicit KROK context. It does not
import or rewrite an archive. Membership in a training selection is user chosen;
it is not a verified claim of an earlier exam error.

Persist and reuse the same session UUID, question list/order and answer index on
network retries. A changed payload for an existing ID raises idempotency_conflict.
Use the original bank answer index, never the shuffled presentation position.
Resume returns ordered questions, revisions, submitted indices and grading
results; it does not expose correct indices for unanswered questions.

There is one active session per user/KROK. Sessions contain 5–50 distinct questions.
A session can be resumed indefinitely; incomplete finalization fails without
closing it. All assigned questions must be answered before finalization. Each
correct answer in a finalized session contributes one mastery credit to that
question (maximum three); three DISTINCT completed sessions mean mastered.
A wrong answer resets that question to zero immediately, even if the session
is never completed. Other correct questions in that session still earn credit on
completion. Repeated requests and repeated finalization cannot add credits or
repeat old resets. Answers are immutable after the first accepted submission.
There is no cooldown or claim of spaced repetition in this increment.

## Isolation and transactions

Four new public tables hold per-user state, sessions, progress and answer
snapshots. All enable RLS. Only own sessions/progress are selectable; no API role
can write directly. Answer snapshots and the private catalog have no API read
grant. The SECURITY DEFINER RPC checks auth.uid(), fixes search_path and scopes
all access by user/KROK. A locked state row serializes mutations for that pair;
separate users/KROKs remain independent. Grading and immediate reset/finalization
run in the same database transaction. Session grading uses a start-time snapshot.
No caller supplies a user ID, correctness, mastery value or grading key.

## Builds

Use the versioned entry points from any working directory:

```
node scripts/build/krok1.js
node scripts/build/krok2.js
node scripts/question-identity/check-manifests.js
```

Legacy build/patch scripts are locally ignored by this repository. Their local
copies also call the gate, but the versioned entry points above are the portable
implementation. Every candidate must match the independently anchored manifest
and whole-bank checksum BEFORE any output is written. This intentionally blocks
legacy renumbering, removals, metadata edits and formatting drift. Approved future
bank changes require a separate reviewed manifest/publication workflow; this MVP
does not bypass that gate. Identical-content records remain separate identities.
An arbitrary external script can still bypass these entry points; no hosting CI
configuration exists here to enforce all deployments.

## Tests

```
npm install --prefix scripts/mistake-training
node --test
node scripts/question-identity/check-manifests.js
```

PGlite 0.5.15 is a test-only, embedded PostgreSQL dependency; no running service
or paid infrastructure is needed. Tests execute the actual migration and seed,
RPC transactions, RLS and grants, retry/conflict paths, incomplete sessions,
mastery/reset, cross-user/KROK isolation and duplicate finalization. The ordinary
identity suite verifies round trips and intentional duplicates. Database tests
use local mock auth.uid()/roles, not production credentials. PGlite has one
connection: queued duplicate requests are tested, but true multi-connection lock
contention and Supabase/PostgREST integration still require a staging smoke test
after authorized migration. No production schema was inspected or modified.

## Tappa 2 — usable MVP

Open `mistake-training.html` from the shared sidebar or Practice saved mistakes.
Choose KROK 1/2, select 5–50 distinct questions, and start training. Unmastered
questions are selected by default (up to ten). Answers use original bank order
and indices; feedback uses the server result. Finalization updates the displayed
credits. Progress is read in stable 500-row pages to avoid PostgREST truncation.
Return/refresh discovers the active session on the server. An unanswered
session remains resumable; there is no abandonment or expiry operation.

### Practice enrollment migration (applied)

The original RPC cannot register a Practice error outside a session. The minimal
reviewable addition is:

`docs/migrations/20261106_mistake_training_practice.sql`

Applied after both Tappa 1 migrations, as confirmed by the project owner. It adds one
private event ledger and one RPC, `mistake_training_record_practice`. No existing
table, policy or training RPC is altered. The RPC validates auth.uid() against
the expected account and validates the canonical identity against the catalog.
It locks the same user/KROK state row as the training engine and upserts progress
to zero. The private ledger makes identical error-event retries no-ops, including
retries received after newer mastery credits. Reusing an event ID for a different
identity is rejected. Registration earns no credits. It records a self-study
Practice mistake; it does not prove a server-graded examination result.

If the RPC is unavailable in an environment, new Practice errors remain in the
per-account local outbox and the UI explains the missing RPC. New sessions are
blocked while pending sync cannot complete, preventing a delayed reset after
training credits. Existing server sessions can still be resumed and completed.
This fallback preserves pending errors without bypassing server registration.

### Practice and auth boundaries

The hook emits a separate event after the original mistake archive is saved.
It runs only for new wrong Practice answers, never Exam or Review answers.
Past Papers are excluded by both paper mode and subject; canonical identity uses
the explicit numeric KROK and exact typed bank ID. The server accepts only catalog
identities. Identical content with different IDs is never merged. Guests' errors
stay in the existing browser archive; signing in does not import earlier errors.

The account available at the new error event owns its outbox. No auth token is
stored in training keys. Network requests obtain a token for the captured account
through a scoped SDK client and reject a mismatching current account. Auth changes
invalidate rendered state immediately; late responses cannot overwrite the new
account's view. Auth callbacks defer network work outside the SDK auth lock.

Local keys are separate from every existing Practice storage key:

- `krok.mt.events.v1:<user>`: stable error-event UUIDs and canonical identities.
- `krok.mt.command.v1:<user>:<krok>`: one pending start/answer/finalize command.

Commands are persisted before dispatch; retry/refresh reuses the exact payload.
Storage failure prevents dispatch and is surfaced instead of inventing a new ID.
Network errors retain pending data. A server response reconciles a duplicate
submission, while first accepted answers remain immutable. Server active sessions
also support resume on another browser/device without a local command. Online
reconnection and Refresh / retry attempt synchronization again. Clearing browser
data before pending errors are synchronized loses that outbox; the old Practice
archive still follows its existing independent storage behavior.

### Verification and remaining manual check

Local tests cover the actual new SQL on embedded PostgreSQL, RLS/EXECUTE denial,
account binding, catalog rejection, immediate reset, event retry after newer
mastery, Practice event boundaries, per-account outboxes, token switching, UI
selection limits, session resume after a lost answer response, feedback,
finalization, logout and KROK separation. Chromium smoke checks use a local HTTP
server and simulated auth/API data; they do not contact Supabase.

Per the project owner's instruction, real Auth/PostgREST testing is deferred.
With a dedicated test account, through the application interface:

1. Sign in through Account; make five distinct mistakes in KROK 1 Practice.
2. Confirm each appears once in training, with 0/3 credits and unchanged local
   Practice archive/counters. Check one Past Paper error does not appear.
3. Start training, answer, refresh/close/reopen, resume and finalize. Repeat
   finalization/retry and confirm credits do not increase twice.
4. Repeat for KROK 2; sign out/switch account and confirm isolation.
5. Disable network, answer or make a Practice error, restore network and retry;
   verify one accepted answer/event and eventual sync without duplicate credit.

No test users or authentication configuration were changed, and no live database
writes were performed by the local verification. Auth/PostgREST smoke testing and
true multi-connection contention testing remain pending.
