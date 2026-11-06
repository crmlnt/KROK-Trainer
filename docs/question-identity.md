# Question Identity Foundation — Sprint C2-A.1

## Scope and published baseline

This foundation is additive. It does not change question banks, converters,
application scripts, Notes, Exam History, Analytics, session storage or Supabase.
No existing HTML file loads the new resolver. No existing pipeline calls the
new commands. Pipeline enforcement and runtime integration need separate review.

On 2026-11-06 both local banks matched their HTTPS production responses byte for
byte. Bootstrap repeated that comparison before writing either manifest.

Baseline commit: `1596581186ef698a539ec0ec22ef3b73e1aed375`.

| Bank | Published URL | Records | SHA-256 |
| --- | --- | ---: | --- |
| KROK 1 | https://kroktrainer.com/questions.json | 2,890 | `e7e83f93809bd08a903272a0b7c4c5166420135b1c032e169e9b0dea7d661c3c` |
| KROK 2 | https://kroktrainer.com/krok2/questions-krok2.json | 2,409 | `0318d565e57956edad31f317641b24edead3882bedbab7d13e97c450d8651aa5` |

The committed snapshot is an independent validation anchor. A shallow checkout
must contain this commit before running validation. Routine validation is offline;
it does not claim that production still matches at a later time.

## Identity and compatibility

The canonical identity is the pair `(krok, questionId)`:

- `(1, "main:123")` corresponds to bank ID `123` (number).
- `(2, "main:krok2-0123")` corresponds to bank ID `"krok2-0123"` (string).

The source namespace is `main`. Past Papers are excluded from this foundation's
resolver; their year/number keys must not be interpreted as ordinary questions.
They remain available through the existing application, which is unchanged.

`question-identity.js` exports `createResolver(manifests)` through CommonJS or,
when explicitly loaded in a browser, `QuestionIdentity`. It never reads storage,
fetches data, accesses the DOM or initializes the application.

The returned API is:

```js
const resolver = createResolver([krok1Manifest, krok2Manifest]);
resolver.resolveIdentity({ krok: 1, format: 'bank', id: 123 });
// { status: 'resolved', identity: { krok: 1, questionId: 'main:123' },
//   legacyId: 123, revision: 1 }
resolver.toBankId({ krok: 1, questionId: 'main:123' }); // 123
resolver.toNoteKey({ krok: 1, questionId: 'main:123' }); // 'krok1-123'
resolver.lookupQuestion({ krok: 1, questionId: 'main:123' }, krok1Bank);
resolver.resolveLegacyMistake(record, new Map([[1, krok1Bank], [2, krok2Bank]]));
```

`resolveIdentity` requires an explicit numeric KROK context and a format:

| Format | Accepted source representation |
| --- | --- |
| `bank` | Exact original JSON ID and type |
| `history` | Exact text representation written by Exam persistence |
| `note` | Existing `krok1-123` / `krok2-0123` key |
| `deepLink` | Existing numeric/prefixed URL conventions, including their normalization |
| `canonical` | `main:123` / `main:krok2-0123` |
| `source` | Explicitly registered, one-hop source alias only |

Deep-link normalization is not applied to History or unknown source records.
Results distinguish `resolved`, `retired`, `excluded` and `unresolved`;
legacy snapshot/lookup ambiguity returns `ambiguous`. Retired identities are
retained but never redirected to a similar active question.

For a legacy mistake, explicit non-main provenance is excluded before matching.
This includes the legacy application's `subject` prefix `Past Paper`, even when
the record has no ID or its snapshot also occurs in a main bank.
A registered explicit ID is then checked first. If a complete
snapshot is supplied, it must agree with that question. With no ID, only an exact,
unique snapshot match is accepted. Both numeric `correct` and textual
`correctAnswer` formats are supported. Ambiguous matches are not selected.
An explicit ID that contradicts its snapshot does not fall back to another ID.

Identity resolution is not authorization to import local data into an account.
The archive's original records are never mutated. Future import requires the
user's explicit confirmation and separate ownership validation.

## Manifest contract

Files: `data/question-identity/krok1-main.manifest.json` and
`data/question-identity/krok2-main.manifest.json`.

- `schemaVersion`: structure version, currently `1`.
- `manifestRevision`: reviewed publication revision, initially `1`.
- `krok`, `namespace`: immutable identity context.
- `hashSpec`: `question-content-v1`.
- `baseline`: immutable committed bank path/hash/count and published verification.
- `currentBankSha256`: hash of the complete current file, including metadata.
- `nextOrdinal`: high-water allocator; initially `2891` / `2410`.
- `entries`: original typed `legacyId`, `status`, `revision`, two fingerprints.
- `aliases`: empty at bootstrap. No historical source aliases are guessed.

Entries are sorted by numeric ordinal, not source position. KROK 2 uses its
existing prefix with a minimum of four digits. Numeric IDs must be positive safe
integers. Noncanonical alternative spellings cannot create another bank identity.

Fingerprint input is UTF-8 `JSON.stringify` of arrays:

```text
contentSha256 = SHA256(JSON.stringify([question, answers, correct]))
gradingSha256 = SHA256(JSON.stringify([answers, correct]))
```

Answer order and the original integer grading index are significant. There is no
case folding, text trimming, answer sorting or fuzzy matching in fingerprints.
Subject and other metadata are covered by the whole-bank checksum; they are not
part of the identity or the content fingerprint. Classifications are preserved.

## Intentional duplicates

Identical questions in different subjects are expected. Their IDs, classifications
and future user progress remain independent. Exact-content groups are reported
for information only. Duplicate IDs are blocking errors.

Fingerprint equality never means identity equality. This foundation does not
create equivalence groups or use them in question selection. Any future selection
optimization requires separate approval; it must not merge Notes, History or
learning progress.

## Reviewed lifecycle rules

1. Existing published IDs keep their identity and original JSON type.
2. New IDs come from the high-water mark; input position never assigns identity.
3. Editorial corrections keep identity only after explicit review and increment
   the entry revision when either fingerprint changes.
4. Replacing a learning item requires a new ID and retirement of the old ID.
5. Retired entries remain as tombstones; their IDs are never recycled.
6. Reactivation requires explicit confirmation that it is the same identity.
7. Source aliases are one-hop, unambiguous references to registered IDs. Standard
   public ID formats cannot be redirected through them. Alias changes need a
   separate reviewed increment and are not accepted by the current CLI.
8. Concurrent branch allocations must be reconciled before publication. Only an
   unpublished proposed ID may be reallocated.

`validateTransition(previous, next, approvedChanges)` provides a tooling-level
guard for future reviewed changes. Each changed entry requires an exact plan:

```text
{ legacyId, action: add|edit|retire|reactivate, reason,
  before: complete previous entry or null,
  after: complete proposed entry }
```

Context/baseline changes, missing tombstones, unreviewed edits, lowering the
allocator and rewriting retired content fail. A fingerprint cannot determine
medical equivalence: a reviewer must reject replacements disguised as edits.
Call `validateManifest` for the proposed bank as well as `validateTransition`.

The foundation CLI accepts no change-plan argument. It compares with the original
committed baseline and therefore rejects unapproved future publication changes,
including coordinated bank/manifest changes. Authoring/allocating publication
changes and enforcing existing pipelines are deliberately deferred.

## Commands and safety

```sh
node scripts/question-identity/check-manifests.js
node --test question-identity.test.js
node --test
```

The standalone validator reads bank/manifest files and the committed baseline,
reports identical content as informational, and exits nonzero on failure. It
writes nothing and uses no network connection.

```sh
node scripts/question-identity/bootstrap.js
node scripts/question-identity/bootstrap.js --write
```

Bootstrap without `--write` verifies production and prints a dry-run report.
`--write` is a one-time creation command: it refuses existing manifest files,
checks both sources before creating either, and uses exclusive file creation.
It never overwrites a question bank. A filesystem failure can leave a partially
created set of new manifests; inspect it rather than automatically deleting or
overwriting it. No script invokes existing converters or touches Supabase.

Tooling is under `scripts/`, because this workspace excludes `/tools/` locally.
No ignore/exclude rules or pre-existing local tools were changed.

## Future server catalog

The future catalog generator must require a successfully validated bank/manifest
pair and preserve `(krok, canonical ID, revision)`, answer count and original
grading index. It must exclude Past Papers. An index from shuffled presentation
cannot be used as the original grading index.

No catalog generation, SQL migration or grading RPC is implemented here. Existing
Notes keys, Exam answer records, Analytics calculations and resume paths remain
unchanged. No legacy bank ID is rewritten merely to adopt canonical identity.

## Size and implementation boundaries

Two SHA-256 values per record plus status/revision yield approximately 1.4 MiB of
formatted manifests for all 5,299 records. There are no copies of question text.
Aliases/tombstones add bounded-per-change metadata; Git holds historical versions.
The manifests are not loaded by the existing frontend and create no database cost.
Hashing uses Node's built-in crypto module; no dependencies were added.

Current tests cover the committed baseline, all published ID round-trips, both
historical mistake formats, subject-preserving duplicates, ambiguous legacy data,
retirement, aliases, immutable context, fingerprint/grading drift, reviewed
transitions, high-water marks, browser isolation and CLI non-overwrite behavior.

Later approved increments may integrate the resolver, protect the local converter
and merge pipelines, and generate a private grading catalog. The current tooling
does not prevent somebody from running an unchanged legacy converter directly;
running the standalone validator is the new explicit review gate.
