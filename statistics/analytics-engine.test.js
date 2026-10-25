const test = require("node:test");
const assert = require("node:assert/strict");
const analytics = require("./analytics-engine.js");

const REFERENCE = "2026-01-31T00:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

function isoDaysBefore(days, extraMilliseconds = 0) {
  return new Date(Date.parse(REFERENCE) - days * DAY_MS + extraMilliseconds).toISOString();
}

function session(id, overrides = {}) {
  return {
    id,
    user_id: "user-1",
    created_at: "2026-01-30T12:00:00.000Z",
    krok: 1,
    mode: "exam",
    subject: "Anatomy",
    questions_total: 10,
    correct: 7,
    wrong: 3,
    score: 70,
    ...overrides
  };
}

function question(examSessionId, questionId, overrides = {}) {
  return {
    id: `${examSessionId}-${questionId}`,
    exam_session_id: examSessionId,
    user_id: "user-1",
    created_at: "2026-01-30T12:01:00.000Z",
    question_id: questionId,
    subject: "Anatomy",
    user_answer: "A",
    correct_answer: "A",
    is_correct: true,
    ...overrides
  };
}

function options(overrides = {}) {
  return { krok: 1, referenceTime: REFERENCE, ...overrides };
}

test("7/30/90-day filters use inclusive starts and exclusive ends", () => {
  const sessions = [
    session("at-7-start", { created_at: isoDaysBefore(7) }),
    session("before-7-start", { created_at: isoDaysBefore(7, -1) }),
    session("at-30-start", { created_at: isoDaysBefore(30) }),
    session("at-90-start", { created_at: isoDaysBefore(90) }),
    session("before-90-start", { created_at: isoDaysBefore(90, -1) }),
    session("before-end", { created_at: isoDaysBefore(0, -1) }),
    session("at-end", { created_at: REFERENCE })
  ];

  assert.deepEqual(
    analytics.filterSessionsByTime(sessions, analytics.TIME_FILTERS.LAST_7_DAYS, options()).map(item => item.id),
    ["at-7-start", "before-end"]
  );
  assert.deepEqual(
    analytics.filterSessionsByTime(sessions, analytics.TIME_FILTERS.LAST_30_DAYS, options()).map(item => item.id),
    ["at-7-start", "before-7-start", "at-30-start", "before-end"]
  );
  assert.deepEqual(
    analytics.filterSessionsByTime(sessions, analytics.TIME_FILTERS.LAST_90_DAYS, options()).map(item => item.id),
    ["at-7-start", "before-7-start", "at-30-start", "at-90-start", "before-end"]
  );
});

test("all-time includes every valid historical timestamp but not future data", () => {
  const sessions = [
    session("old", { created_at: "2001-01-01T00:00:00Z" }),
    session("recent"),
    session("future", { created_at: REFERENCE }),
    session("invalid-date", { created_at: "not-a-date" })
  ];
  const filtered = analytics.filterSessionsByTime(
    sessions,
    analytics.TIME_FILTERS.ALL_TIME,
    options()
  );
  assert.deepEqual(filtered.map(item => item.id), ["old", "recent"]);
});

test("overall analytics isolate KROK versions and exclude Practice Mode", () => {
  const sessions = [
    session("k1", { questions_total: 10, correct: 6 }),
    session("k2", { krok: 2, questions_total: 20, correct: 20 }),
    session("practice", { mode: "practice", questions_total: 100, correct: 100 })
  ];

  const krok1 = analytics.calculateOverallPerformance(sessions, options());
  assert.equal(krok1.sessionCount, 1);
  assert.equal(krok1.questionCount, 10);
  assert.equal(krok1.correctCount, 6);
  assert.equal(krok1.accuracy, 60);
  assert.equal(krok1.excludedSessionCount, 2);
  assert.deepEqual(krok1.window, analytics.getTimeWindow(analytics.TIME_FILTERS.ALL_TIME, REFERENCE));
  assert.equal(analytics.calculateOverallPerformance(sessions, options({ krok: 2 })).accuracy, 100);
});

test("overall accuracy is question-weighted, not a mean of session percentages", () => {
  const result = analytics.calculateOverallPerformance([
    session("small", { questions_total: 1, correct: 1, score: 100 }),
    session("large", { questions_total: 9, correct: 0, score: 0 })
  ], options());

  assert.equal(result.accuracy, 10);
  assert.notEqual(result.accuracy, 50);
});

test("coverage classifies complete, missing, partial, unknown and zero-question sessions", () => {
  const sessions = [
    session("complete", { questions_total: 2, correct: 1 }),
    session("missing", { questions_total: 2, correct: 1 }),
    session("partial", { questions_total: 2, correct: 1 }),
    session("unknown", { questions_total: null, correct: null }),
    session("zero", { questions_total: 0, correct: 0, wrong: 0, score: 0 })
  ];
  const questions = [
    question("complete", "q1"),
    question("complete", "q2", { is_correct: false }),
    question("partial", "q1"),
    question("unknown", "q1")
  ];
  const coverage = analytics.classifyHistoricalCoverage(sessions, questions, options());

  assert.deepEqual(coverage.counts, {
    complete: 1,
    missing: 1,
    partial: 1,
    unknown: 1,
    inconsistent: 0,
    not_applicable: 1
  });
  assert.equal(coverage.sessions.find(item => item.sessionId === "zero").zeroQuestionSession, true);
  assert.equal(coverage.sessions.find(item => item.sessionId === "zero").status, "not_applicable");
  assert.equal(coverage.sessions.find(item => item.sessionId === "zero").eligibleForQuestionAnalytics, false);
});

test("complete All Topics sessions contribute to normalized subjects without session fallback", () => {
  const sessions = [
    session("mixed", { subject: "All Topics", questions_total: 3, correct: 2 }),
    session("missing-details", { subject: "All Topics", questions_total: 10, correct: 10 })
  ];
  const questions = [
    question("mixed", "q1", { subject: "Normal Phisiology" }),
    question("mixed", "q2", { subject: "Normal Physiology", is_correct: false }),
    question("mixed", "q3", { subject: "Anatomy" })
  ];
  const result = analytics.calculateSubjectPerformance(sessions, questions, options());

  assert.deepEqual(result.subjects, [
    { subject: "Anatomy", questionCount: 1, correctCount: 1, sessionCount: 1, accuracy: 100 },
    { subject: "Normal Physiology", questionCount: 2, correctCount: 1, sessionCount: 1, accuracy: 50 }
  ]);
  assert.deepEqual(result.coverage, {
    complete: 1,
    missing: 1,
    partial: 0,
    unknown: 0,
    inconsistent: 0,
    not_applicable: 0
  });
  assert.equal(sessions[0].subject, "All Topics");
  assert.equal(questions[0].subject, "Normal Phisiology");
});

test("persisted Past Paper labels attribute real question subjects without weakening consistency", () => {
  const sessions = [
    session("past-paper", {
      subject: "Past Paper 2023",
      questions_total: 3,
      correct: 2,
      wrong: 1,
      score: 67
    }),
    session("malformed-past-paper", {
      subject: "Past Paper 23",
      questions_total: 1,
      correct: 1,
      wrong: 0,
      score: 100
    }),
    session("arbitrary-label", {
      subject: "Mixed Review",
      questions_total: 1,
      correct: 1,
      wrong: 0,
      score: 100
    })
  ];
  const questions = [
    question("past-paper", "q1", { subject: "Anatomy" }),
    question("past-paper", "q2", { subject: "Pharmacology", is_correct: false }),
    question("past-paper", "q3", { subject: "Normal Physiology" }),
    question("malformed-past-paper", "q1", { subject: "Anatomy" }),
    question("arbitrary-label", "q1", { subject: "Anatomy" })
  ];
  const result = analytics.calculateSubjectPerformance(sessions, questions, options());

  assert.deepEqual(result.subjects, [
    { subject: "Anatomy", questionCount: 1, correctCount: 1, sessionCount: 1, accuracy: 100 },
    { subject: "Normal Physiology", questionCount: 1, correctCount: 1, sessionCount: 1, accuracy: 100 },
    { subject: "Pharmacology", questionCount: 1, correctCount: 0, sessionCount: 1, accuracy: 0 }
  ]);
  assert.equal(result.coverage.complete, 1);
  assert.equal(result.coverage.inconsistent, 2);
});

test("Past Paper metadata detail rows are present but explicitly unavailable for subject attribution", () => {
  const sessions = [session("past-paper-metadata", {
    subject: "Past Paper 2023",
    questions_total: 2,
    correct: 1,
    wrong: 1,
    score: 50
  })];
  const questions = [
    question("past-paper-metadata", "2023-1", {
      subject: "Past Paper 2023",
      is_correct: true
    }),
    question("past-paper-metadata", "2023-2", {
      subject: "Past Paper 2023",
      is_correct: false
    })
  ];
  const overall = analytics.calculateOverallPerformance(sessions, options());
  const subjects = analytics.calculateSubjectPerformance(sessions, questions, options());
  const coverage = analytics.classifyHistoricalCoverage(sessions, questions, options());
  const detail = coverage.sessions[0];

  assert.equal(overall.sessionCount, 1);
  assert.equal(overall.questionCount, 2);
  assert.equal(overall.correctCount, 1);
  assert.deepEqual(subjects.subjects, []);
  assert.equal(coverage.counts.missing, 0);
  assert.equal(coverage.questionLevel.missingDetailSessionCount, 0);
  assert.equal(coverage.questionLevel.unattributedSessionCount, 1);
  assert.equal(detail.status, "inconsistent");
  assert.equal(detail.rawDetailRecordCount, 2);
  assert.equal(detail.subjectAttributionStatus, "unavailable");
  assert.equal(detail.metadataSubjectRecordCount, 2);
  assert.ok(detail.issues.includes("missing_usable_subject_attribution"));
});

test("empty and malformed datasets return safe empty metrics", () => {
  const malformed = [
    null,
    {},
    session("bad-date", { created_at: "2026-01-30 12:00:00" }),
    session("bad-total", { questions_total: -1 }),
    session("bad-correct", { questions_total: 2, correct: 3 })
  ];
  const empty = analytics.calculateOverallPerformance(malformed, options());
  assert.equal(empty.sessionCount, 0);
  assert.equal(empty.questionCount, 0);
  assert.equal(empty.accuracy, null);
  assert.deepEqual(analytics.calculateSubjectPerformance([], null, options()).subjects, []);
});

test("recent and previous comparison windows are equal and non-overlapping", () => {
  const sessions = [
    session("previous-start", { created_at: isoDaysBefore(14), questions_total: 10, correct: 5 }),
    session("recent-start", { created_at: isoDaysBefore(7), questions_total: 10, correct: 8 }),
    session("recent-middle", { created_at: isoDaysBefore(1), questions_total: 10, correct: 10 }),
    session("excluded-end", { created_at: REFERENCE, questions_total: 100, correct: 0 })
  ];
  const result = analytics.compareRecentToPrevious(sessions, options({
    days: 7,
    minimumQuestions: 1,
    stableThresholdPercentagePoints: 1
  }));

  assert.equal(result.previous.questionCount, 10);
  assert.equal(result.recent.questionCount, 20);
  assert.equal(result.previous.end, result.recent.start);
  assert.equal(result.differencePercentagePoints, 40);
  assert.equal(result.status, "improving");
  assert.match(result.note, /does not establish statistical significance/);
});

test("comparison distinguishes insufficient samples and reports both sample sizes", () => {
  const result = analytics.compareRecentToPrevious([
    session("recent", { created_at: isoDaysBefore(1), questions_total: 9, correct: 9 }),
    session("previous", { created_at: isoDaysBefore(8), questions_total: 10, correct: 0 })
  ], options({ days: 7, minimumQuestions: 10 }));

  assert.equal(result.status, "insufficient_data");
  assert.equal(result.differencePercentagePoints, null);
  assert.equal(result.recent.questionCount, 9);
  assert.equal(result.previous.questionCount, 10);
});

test("comparison classifies stable and declining observations with a configurable threshold", () => {
  const stable = analytics.compareRecentToPrevious([
    session("stable-recent", { created_at: isoDaysBefore(1), questions_total: 100, correct: 71 }),
    session("stable-previous", { created_at: isoDaysBefore(8), questions_total: 100, correct: 70 })
  ], options({ days: 7, minimumQuestions: 1, stableThresholdPercentagePoints: 1 }));
  assert.equal(stable.status, "stable");
  assert.equal(stable.differencePercentagePoints, 1);

  const declining = analytics.compareRecentToPrevious([
    session("declining-recent", { created_at: isoDaysBefore(1), questions_total: 10, correct: 4 }),
    session("declining-previous", { created_at: isoDaysBefore(8), questions_total: 10, correct: 8 })
  ], options({ days: 7, minimumQuestions: 1, stableThresholdPercentagePoints: 1 }));
  assert.equal(declining.status, "declining");
  assert.equal(declining.differencePercentagePoints, -40);
});

test("duplicate question records make a detail set inconsistent and prevent double counting", () => {
  const sessions = [session("duplicate", { questions_total: 2, correct: 2 })];
  const questions = [
    question("duplicate", "q1"),
    question("duplicate", "q1"),
    question("duplicate", "q2")
  ];
  const coverage = analytics.classifyHistoricalCoverage(sessions, questions, options());
  const subjects = analytics.calculateSubjectPerformance(sessions, questions, options());

  assert.equal(coverage.sessions[0].status, "inconsistent");
  assert.equal(coverage.sessions[0].duplicateQuestionCount, 1);
  assert.deepEqual(subjects.subjects, []);
});

test("learning trend is chronological, UTC-daily, weighted, and omits empty periods", () => {
  const sessions = [
    session("later-small", { created_at: "2026-01-03T20:00:00Z", questions_total: 1, correct: 1 }),
    session("earlier", { created_at: "2026-01-01T23:00:00-02:00", questions_total: 4, correct: 2 }),
    session("later-large", { created_at: "2026-01-03T01:00:00Z", questions_total: 9, correct: 0 }),
    session("zero", { created_at: "2026-01-02T12:00:00Z", questions_total: 0, correct: 0 })
  ];
  const trend = analytics.generateLearningTrend(sessions, options());

  assert.equal(trend.grouping, "utc_day_with_data");
  assert.deepEqual(trend.points, [
    { period: "2026-01-02", sessionCount: 1, correctCount: 2, questionCount: 4, accuracy: 50 },
    { period: "2026-01-03", sessionCount: 2, correctCount: 1, questionCount: 10, accuracy: 10 }
  ]);
});

test("invalid question identifiers are rejected while legitimate string IDs are preserved", () => {
  const invalidIds = [NaN, true, ["q1"], { id: "q1" }];
  const sessions = invalidIds.map((_, index) =>
    session(`invalid-id-${index}`, { questions_total: 1, correct: 1 })
  );
  sessions.push(session("string-id", { questions_total: 1, correct: 1 }));
  const questions = invalidIds.map((questionId, index) =>
    question(`invalid-id-${index}`, questionId)
  );
  questions.push(question("string-id", "question:alpha-01"));

  const coverage = analytics.classifyHistoricalCoverage(sessions, questions, options());
  for (let index = 0; index < invalidIds.length; index += 1) {
    const item = coverage.sessions.find(entry => entry.sessionId === `invalid-id-${index}`);
    assert.equal(item.status, "partial");
    assert.ok(item.issues.includes("invalid_question_id"));
  }
  assert.equal(coverage.sessions.find(item => item.sessionId === "string-id").status, "complete");
});

test("session and detail correct counts must agree for question analytics", () => {
  const sessions = [session("contradictory", { questions_total: 2, correct: 2 })];
  const questions = [
    question("contradictory", "q1", { is_correct: true }),
    question("contradictory", "q2", { is_correct: false })
  ];
  const coverage = analytics.classifyHistoricalCoverage(sessions, questions, options());
  const detail = coverage.sessions[0];

  assert.equal(detail.status, "inconsistent");
  assert.equal(detail.sessionCorrectCount, 2);
  assert.equal(detail.detailCorrectCount, 1);
  assert.ok(detail.issues.includes("correct_count_mismatch"));
  assert.deepEqual(analytics.calculateSubjectPerformance(sessions, questions, options()).subjects, []);
});

test("zero-question sessions are not meaningful performance or complete coverage", () => {
  const sessions = [session("zero-only", {
    questions_total: 0,
    correct: 0,
    wrong: 0,
    score: 0
  })];
  const overall = analytics.calculateOverallPerformance(sessions, options());
  const coverage = analytics.classifyHistoricalCoverage(sessions, [], options());

  assert.equal(overall.sessionCount, 0);
  assert.equal(overall.zeroQuestionSessionCount, 1);
  assert.equal(overall.accuracy, null);
  assert.equal(coverage.counts.not_applicable, 1);
  assert.equal(coverage.counts.complete, 0);
  assert.equal(coverage.questionLevel.analyzedSessionCount, 0);
});

test("duplicate sessions are deduplicated and conflicting duplicates are excluded everywhere", () => {
  const exact = session("same", { questions_total: 1, correct: 1 });
  const sessions = [
    exact,
    { ...exact },
    session("conflict", { questions_total: 1, correct: 1 }),
    session("conflict", { questions_total: 1, correct: 0 })
  ];
  const questions = [question("same", "q1")];
  const filtered = analytics.filterSessionsByTime(
    sessions,
    analytics.TIME_FILTERS.ALL_TIME,
    options()
  );
  const overall = analytics.calculateOverallPerformance(sessions, options());
  const coverage = analytics.classifyHistoricalCoverage(sessions, questions, options());
  const subjects = analytics.calculateSubjectPerformance(sessions, questions, options());
  const trend = analytics.generateLearningTrend(sessions, options());
  const built = analytics.buildAnalytics(sessions, questions, options());

  assert.deepEqual(filtered.map(item => item.id), ["same"]);
  assert.equal(overall.sessionCount, 1);
  assert.deepEqual(overall.integrity.duplicateSessionIds, ["same"]);
  assert.deepEqual(overall.integrity.conflictingSessionIds, ["conflict"]);
  assert.equal(coverage.sessions.length, 1);
  assert.equal(subjects.subjects[0].questionCount, 1);
  assert.equal(trend.points[0].sessionCount, 1);
  assert.equal(built.overall.sessionCount, 1);

  const comparison = analytics.compareRecentToPrevious([
    session("recent-duplicate", { created_at: isoDaysBefore(1), questions_total: 10, correct: 10 }),
    session("recent-duplicate", { created_at: isoDaysBefore(1), questions_total: 10, correct: 10 }),
    session("previous-unique", { created_at: isoDaysBefore(8), questions_total: 10, correct: 5 })
  ], options({ days: 7, minimumQuestions: 1 }));
  assert.equal(comparison.recent.questionCount, 10);
  assert.equal(comparison.recent.sessionCount, 1);
});

test("exact one-point differences are stable in both directions", () => {
  const forward = analytics.compareRecentToPrevious([
    session("recent-30", { created_at: isoDaysBefore(1), questions_total: 100, correct: 30 }),
    session("previous-29", { created_at: isoDaysBefore(8), questions_total: 100, correct: 29 })
  ], options({ days: 7, minimumQuestions: 1, stableThresholdPercentagePoints: 1 }));
  assert.equal(forward.differencePercentagePoints, 1);
  assert.equal(forward.status, "stable");

  const reverse = analytics.compareRecentToPrevious([
    session("recent-29", { created_at: isoDaysBefore(1), questions_total: 100, correct: 29 }),
    session("previous-30", { created_at: isoDaysBefore(8), questions_total: 100, correct: 30 })
  ], options({ days: 7, minimumQuestions: 1, stableThresholdPercentagePoints: 1 }));
  assert.equal(reverse.differencePercentagePoints, -1);
  assert.equal(reverse.status, "stable");
});

test("PostgreSQL offsets and leap dates are accepted; impossible dates are rejected", () => {
  const sessions = [
    session("offset-hour", { created_at: "2026-01-30 20:00:00+00" }),
    session("offset-compact", { created_at: "2026-01-30T20:00:00+0000" }),
    session("offset-colon", { created_at: "2026-01-30T22:00:00+02:00" }),
    session("leap", { created_at: "2024-02-29T12:00:00Z" }),
    session("not-leap", { created_at: "2025-02-29T12:00:00Z" }),
    session("bad-day", { created_at: "2026-04-31T12:00:00Z" }),
    session("no-zone", { created_at: "2026-01-30T12:00:00" }),
    session("bad-offset", { created_at: "2026-01-30T12:00:00+24:00" })
  ];
  const filtered = analytics.filterSessionsByTime(
    sessions,
    analytics.TIME_FILTERS.ALL_TIME,
    options()
  );
  assert.deepEqual(filtered.map(item => item.id), ["offset-hour", "offset-compact", "offset-colon", "leap"]);

  const window = analytics.getTimeWindow(
    analytics.TIME_FILTERS.LAST_7_DAYS,
    "2026-01-31 00:00:00+00"
  );
  assert.equal(window.end, Date.parse(REFERENCE));
});

test("cross-user details are inconsistent while omitted ownership remains projection-safe", () => {
  const ownedSession = session("owned", { questions_total: 1, correct: 1, user_id: "user-a" });
  const crossUser = analytics.classifyHistoricalCoverage([ownedSession], [
    question("owned", "q1", { user_id: "user-b" })
  ], options());
  assert.equal(crossUser.sessions[0].status, "inconsistent");
  assert.ok(crossUser.sessions[0].issues.includes("ownership_mismatch"));

  const projected = analytics.classifyHistoricalCoverage([ownedSession], [
    question("owned", "q1", { user_id: undefined })
  ], options());
  assert.equal(projected.sessions[0].status, "complete");
});

test("numeric fields reject coercive values but accept Supabase numeric strings", () => {
  const invalid = [true, false, [], [1], "   ", null, {}, "1.5"];
  const sessions = invalid.map((value, index) =>
    session(`bad-number-${index}`, { questions_total: value, correct: 0 })
  );
  sessions.push(session("bad-correct-boolean", { questions_total: 1, correct: true }));
  sessions.push(session("valid-numeric-strings", { questions_total: "10", correct: "7" }));
  const result = analytics.calculateOverallPerformance(sessions, options());

  assert.equal(result.sessionCount, 1);
  assert.equal(result.questionCount, 10);
  assert.equal(result.correctCount, 7);
});

test("metadata and conflicting subject labels are excluded without rewriting assignments", () => {
  const sessions = [
    session("metadata", { subject: "All Topics", questions_total: 1, correct: 1 }),
    session("mismatch", { subject: "Anatomy", questions_total: 1, correct: 1 })
  ];
  const questions = [
    question("metadata", "q1", { subject: "All Topics" }),
    question("mismatch", "q1", { subject: "Normal Physiology" })
  ];
  const coverage = analytics.classifyHistoricalCoverage(sessions, questions, options());
  const subjects = analytics.calculateSubjectPerformance(sessions, questions, options());

  assert.equal(coverage.sessions.find(item => item.sessionId === "metadata").status, "inconsistent");
  assert.equal(coverage.sessions.find(item => item.sessionId === "mismatch").status, "inconsistent");
  assert.deepEqual(subjects.subjects, []);
  assert.equal(questions[0].subject, "All Topics");
  assert.equal(questions[1].subject, "Normal Physiology");
});

test("coverage explicitly separates session metrics from missing question details", () => {
  const coverage = analytics.classifyHistoricalCoverage([
    session("missing-details", { questions_total: 10, correct: 7 })
  ], [], options());

  assert.equal(coverage.counts.missing, 1);
  assert.equal(coverage.sessionLevel.meaningfulPerformanceSessionCount, 1);
  assert.equal(coverage.questionLevel.analyzedSessionCount, 0);
  assert.equal(coverage.questionLevel.missingDetailSessionCount, 1);
  assert.equal(coverage.sessions[0].eligibleForSessionAnalytics, true);
  assert.equal(coverage.sessions[0].eligibleForQuestionAnalytics, false);
});

test("input records remain immutable", () => {
  const sessions = [session("immutable", { questions_total: 1, correct: 0 })];
  const questions = [question("immutable", "q1", {
    subject: "Normal Phisiology",
    user_answer: null,
    is_correct: false
  })];
  const snapshot = JSON.stringify({ sessions, questions });
  Object.freeze(sessions[0]);
  Object.freeze(questions[0]);
  Object.freeze(sessions);
  Object.freeze(questions);

  analytics.buildAnalytics(sessions, questions, options());
  assert.equal(JSON.stringify({ sessions, questions }), snapshot);
});

test("question accuracy trusts explicit is_correct and never derives it from user_answer", () => {
  const sessions = [session("unanswered", { questions_total: 1, correct: 0 })];
  const explicit = analytics.calculateSubjectPerformance(sessions, [
    question("unanswered", "q1", { user_answer: null, is_correct: false })
  ], options());
  assert.equal(explicit.subjects[0].questionCount, 1);
  assert.equal(explicit.subjects[0].accuracy, 0);

  const unspecified = analytics.calculateSubjectPerformance(sessions, [
    question("unanswered", "q1", { user_answer: null, is_correct: null })
  ], options());
  assert.deepEqual(unspecified.subjects, []);
  assert.equal(unspecified.coverage.partial, 1);
});

function trendFixture(subject, olderCorrect, newerCorrect, overrides = {}) {
  const olderCount = overrides.olderCount ?? 20;
  const newerCount = overrides.newerCount ?? 20;
  const sessionId = overrides.sessionId ?? `trend-${subject}`;
  const trendSession = session(sessionId, {
    created_at: overrides.created_at ?? "2026-01-20T12:00:00Z",
    krok: overrides.krok ?? 1,
    mode: overrides.mode ?? "exam",
    subject: overrides.sessionSubject ?? subject,
    questions_total: olderCount + newerCount,
    correct: olderCorrect + newerCorrect,
    wrong: olderCount + newerCount - olderCorrect - newerCorrect,
    score: ((olderCorrect + newerCorrect) / (olderCount + newerCount)) * 100
  });
  const rows = Array.from({ length: olderCount + newerCount }, (_, index) =>
    question(sessionId, `q-${String(index + 1).padStart(3, "0")}`, {
      id: `${sessionId}-row-${index + 1}`,
      subject,
      is_correct: index < olderCount
        ? index < olderCorrect
        : index - olderCount < newerCorrect
    })
  );
  return { session: trendSession, rows };
}

test("subject trends classify improving, stable, declining, and insufficient samples", () => {
  const fixtures = [
    trendFixture("Anatomy", 10, 15),
    trendFixture("Histology", 11, 11),
    trendFixture("Pharmacology", 15, 10),
    trendFixture("Pathology", 9, 10, { olderCount: 19, newerCount: 20 })
  ];
  const result = analytics.calculateSubjectTrends(
    fixtures.map(item => item.session),
    fixtures.flatMap(item => item.rows),
    options()
  );
  const bySubject = Object.fromEntries(result.subjects.map(item => [item.subject, item]));

  assert.equal(bySubject.Anatomy.status, "improving");
  assert.equal(bySubject.Anatomy.differencePercentagePoints, 25);
  assert.equal(bySubject.Histology.status, "stable");
  assert.equal(bySubject.Pharmacology.status, "declining");
  assert.equal(bySubject.Pharmacology.differencePercentagePoints, -25);
  assert.equal(bySubject.Pathology.status, "insufficient_data");
  assert.equal(bySubject.Pathology.differencePercentagePoints, null);
});

test("subject trends accept exactly 20 responses per half and split odd totals deterministically", () => {
  const exact = trendFixture("Anatomy", 10, 11);
  const odd = trendFixture("Histology", 10, 11, { olderCount: 20, newerCount: 21 });
  const result = analytics.calculateSubjectTrends(
    [odd.session, exact.session],
    [...odd.rows, ...exact.rows].reverse(),
    options()
  );
  const bySubject = Object.fromEntries(result.subjects.map(item => [item.subject, item]));

  assert.deepEqual(
    [bySubject.Anatomy.older.questionCount, bySubject.Anatomy.newer.questionCount],
    [20, 20]
  );
  assert.equal(bySubject.Anatomy.status, "improving");
  assert.deepEqual(
    [bySubject.Histology.older.questionCount, bySubject.Histology.newer.questionCount],
    [20, 21]
  );
});

test("subject trend ordering uses parent timestamps with deterministic session and question ties", () => {
  const older = trendFixture("Anatomy", 0, 0, {
    olderCount: 10,
    newerCount: 10,
    sessionId: "1",
    created_at: "2026-01-20T12:00:00Z"
  });
  const newer = trendFixture("Anatomy", 20, 20, {
    olderCount: 20,
    newerCount: 20,
    sessionId: "2",
    created_at: "2026-01-20T12:00:00Z"
  });
  const sessions = [newer.session, older.session];
  const rows = [...newer.rows, ...older.rows].reverse();
  const first = analytics.calculateSubjectTrends(sessions, rows, options()).subjects[0];
  const second = analytics.calculateSubjectTrends(
    sessions.slice().reverse(),
    rows.slice().reverse(),
    options()
  ).subjects[0];

  assert.deepEqual(first, second);
  assert.equal(first.older.questionCount, 30);
  assert.equal(first.newer.questionCount, 30);
  assert.equal(first.status, "improving");
});

test("subject trends normalize names and isolate KROK versions and Practice Mode", () => {
  const krok1 = trendFixture("Normal Phisiology", 10, 15, { sessionId: "k1" });
  const krok2 = trendFixture("Normal Phisiology", 15, 10, { sessionId: "k2", krok: 2 });
  const practice = trendFixture("Normal Phisiology", 0, 20, {
    sessionId: "practice",
    mode: "practice"
  });
  const sessions = [krok1.session, krok2.session, practice.session];
  const rows = [...krok1.rows, ...krok2.rows, ...practice.rows];

  const k1Trend = analytics.calculateSubjectTrends(sessions, rows, options()).subjects[0];
  const k2Trend = analytics.calculateSubjectTrends(sessions, rows, options({ krok: 2 })).subjects[0];
  assert.equal(k1Trend.subject, "Normal Physiology");
  assert.equal(k1Trend.status, "improving");
  assert.equal(k2Trend.status, "declining");
});

test("subject trends exclude Past Paper metadata and sessions with missing or inconsistent details", () => {
  const metadata = trendFixture("Past Paper 2024", 10, 15, {
    sessionId: "metadata",
    sessionSubject: "Past Paper 2024"
  });
  const missing = session("missing", {
    subject: "Anatomy",
    questions_total: 40,
    correct: 20,
    wrong: 20
  });
  const inconsistent = trendFixture("Histology", 10, 15, { sessionId: "inconsistent" });
  inconsistent.session.correct = 24;

  const result = analytics.calculateSubjectTrends(
    [metadata.session, missing, inconsistent.session],
    [...metadata.rows, ...inconsistent.rows],
    options()
  );
  assert.deepEqual(result.subjects, []);
});

test("subject exam series groups normalized subject questions per session with deterministic ordering", () => {
  const sessions = [
    session("10", { created_at: "2026-01-20T12:00:00Z", subject: "All Topics", questions_total: 3, correct: 2 }),
    session("2", { created_at: "2026-01-20T12:00:00Z", subject: "Normal Physiology", questions_total: 1, correct: 0 }),
    session("earlier", { created_at: "2026-01-19T12:00:00Z", subject: "Normal Physiology", questions_total: 2, correct: 1 })
  ];
  const questions = [
    question("10", "p1", { subject: "Normal Phisiology", is_correct: true }),
    question("10", "p2", { subject: "Normal Physiology", is_correct: false }),
    question("10", "a1", { subject: "Anatomy", is_correct: true }),
    question("2", "p1", { subject: "Normal Physiology", is_correct: false }),
    question("earlier", "p1", { subject: "Normal Physiology", is_correct: true }),
    question("earlier", "p2", { subject: "Normal Physiology", is_correct: false })
  ];

  const result = analytics.calculateSubjectExamSeries(sessions, questions, options({
    subject: "Normal Phisiology"
  }));

  assert.equal(result.subject, "Normal Physiology");
  assert.equal(result.krok, 1);
  assert.deepEqual(result.points.map(point => point.sessionId), ["earlier", "2", "10"]);
  assert.deepEqual(result.points.map(point => [point.questionCount, point.correctCount, point.accuracy]), [
    [2, 1, 50],
    [1, 0, 0],
    [2, 1, 50]
  ]);
});

test("subject exam series isolates KROK, Exam Mode, and temporal boundaries", () => {
  const sessions = [
    session("at-start", { created_at: isoDaysBefore(7), questions_total: 1, correct: 1 }),
    session("before-start", { created_at: isoDaysBefore(7, -1), questions_total: 1, correct: 1 }),
    session("future", { created_at: REFERENCE, questions_total: 1, correct: 1 }),
    session("practice", { created_at: isoDaysBefore(1), mode: "practice", questions_total: 1, correct: 1 }),
    session("krok-2", { created_at: isoDaysBefore(1), krok: 2, questions_total: 1, correct: 1 })
  ];
  const questions = sessions.map(item => question(item.id, "q1"));

  const krok1 = analytics.calculateSubjectExamSeries(sessions, questions, options({
    subject: "Anatomy",
    filter: analytics.TIME_FILTERS.LAST_7_DAYS
  }));
  const krok2 = analytics.calculateSubjectExamSeries(sessions, questions, options({
    subject: "Anatomy",
    krok: 2,
    filter: analytics.TIME_FILTERS.LAST_7_DAYS
  }));

  assert.deepEqual(krok1.points.map(point => point.sessionId), ["at-start"]);
  assert.deepEqual(krok2.points.map(point => point.sessionId), ["krok-2"]);
  assert.equal(krok1.window.start, Date.parse(isoDaysBefore(7)));
});

test("subject exam series excludes every non-complete or unattributed detail set", () => {
  const sessions = [
    session("valid", { questions_total: 1, correct: 1 }),
    session("missing", { questions_total: 1, correct: 1 }),
    session("partial", { questions_total: 2, correct: 1 }),
    session("duplicate", { questions_total: 2, correct: 2 }),
    session("inconsistent", { questions_total: 1, correct: 0 }),
    session("unattributed", { subject: "Past Paper 2024", questions_total: 1, correct: 1 })
  ];
  const questions = [
    question("valid", "q1"),
    question("partial", "q1"),
    question("duplicate", "q1"),
    question("duplicate", "q1", { id: "duplicate-second" }),
    question("inconsistent", "q1", { is_correct: true }),
    question("unattributed", "q1", { subject: "Past Paper 2024" })
  ];

  const result = analytics.calculateSubjectExamSeries(sessions, questions, options({
    subject: "Anatomy"
  }));
  assert.deepEqual(result.points.map(point => point.sessionId), ["valid"]);

  const empty = analytics.calculateSubjectExamSeries(sessions, questions, options({
    subject: "Histology",
    filter: analytics.TIME_FILTERS.LAST_7_DAYS
  }));
  assert.deepEqual(empty.points, []);
  assert.throws(
    () => analytics.calculateSubjectExamSeries(sessions, questions, options({ subject: "Past Paper 2024" })),
    /valid medical subject/
  );
});
