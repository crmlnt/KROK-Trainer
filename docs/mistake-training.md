# Mistake Training — Tappa 1

Implemented engine; SQL is prepared, NOT applied. No page loads the client yet.
No changes to Notes, History, Analytics, Practice counters or question banks.

## Installation after SQL review

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

Remaining integration work: an explicit training UI must choose resolved mistakes,
persist its session UUID and map shuffled answers back to original indices. This
increment delivers the engine and client API; it does not auto-load a UI or deploy
SQL. Session abandonment/expiry and automatic archive import are not included.
