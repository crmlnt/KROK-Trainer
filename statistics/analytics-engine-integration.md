# Analytics 2.0 — Integration contract

Sprint 2 connects the validated analytics engine to the current Statistics UI
through `statistics-integration.js`.

The integration now guarantees that:

1. Both Supabase tables are loaded in deterministic, explicitly ranged pages
   scoped to the authenticated `user_id`.
2. Question rows include `question_id`, `exam_session_id`, `user_id`,
   `subject`, and `is_correct`; transport `id` is also selected so overlapping
   pages can be deduplicated without hiding real duplicate question records.
3. Any failed or incomplete detail fetch aborts the whole statistics load. It
   is never reinterpreted as `missing` coverage. A missing detail set is neutral:
   the engine cannot prove whether it is historical or the result of a failed
   non-transactional persistence operation.
4. The adapter maps engine output to the legacy renderer fields used by
   Performance by Subject and Weak Subjects while preserving exact internal
   accuracy values.
5. Full coverage data remains available as `window.KrokStatisticsCoverage` for
   a future coverage UI. Missing-detail sessions are excluded from subjects.
   Detail rows that contain only metadata labels such as `Past Paper YYYY` are
   reported separately as unavailable subject attribution, not as missing rows.

The adapter uses the engine's validated PostgreSQL timestamp parser for progress
ordering, then emits a numeric timestamp and canonical UTC ISO string. Statistics
rendering never asks the browser to parse a raw PostgreSQL timestamp.

Displayed percentages are truncated to one decimal place. Exact values continue
to drive the established Weak Subjects boundaries, so a value below 50% or 64%
cannot be rounded up to the corresponding displayed threshold.

Per-subject trends use only complete, consistent Exam Mode question details with
usable medical-subject attribution. Each KROK version is calculated separately.
Eligible responses are sorted by parent-session timestamp, session identity, and
question identity, then split into an older half and a newer half. Both halves
must contain at least 20 responses. A change of at least +5 percentage points is
improving, at most -5 is declining, and changes between those bounds are stable.
When both KROK versions independently have sufficient data for the same merged
subject card, the UI withholds a combined trend rather than mixing the histories.

Temporal Statistics views use the engine's `all_time`, `last_90_days`,
`last_30_days`, and `last_7_days` filters. One reference timestamp is captured
after the validated dataset is loaded and reused for every view. The UI retains
the loaded sessions and question records in memory, caches at most one view per
filter, and makes no additional Supabase request when the selected period
changes. The selected period scopes KPIs, per-exam progress, subjects, subject
classification and trends, KROK breakdown, and coverage metadata together.
Filtered subject trends never fall back to all-history data.

Pagination requires a valid exact count on the first page. Intermediate pages
reuse that expected total without repeating the count operation. Multi-page
loads perform one final exact-count check and fail if the total changed. Stable
ordering, physical-row deduplication, and final count verification detect count
changes, shifted pages, and most concurrent inserts/deletes. They cannot provide
a transactional snapshot: an equal-count replacement during pagination can
still produce a mixed-time view. Eliminating that limitation requires a
server-side transaction or snapshot-capable API.

Future UI work must not weaken identifier, ownership, duplicate, subject, or
session/detail consistency checks in the engine.
