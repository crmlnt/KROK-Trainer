const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("./analytics-engine.js");
const integration = require("./statistics-integration.js");
const pageController = require("./statistics-page-controller.js");

const REFERENCE = "2027-01-01T00:00:00Z";

function session(id, overrides = {}) {
  return {
    id,
    user_id: "user-1",
    created_at: `2026-01-${String((Number(id) % 20) + 1).padStart(2, "0")}T12:00:00Z`,
    krok: 1,
    mode: "exam",
    subject: "Anatomy",
    questions_total: 1,
    correct: 1,
    wrong: 0,
    score: 100,
    ...overrides
  };
}

function question(id, examSessionId, questionId, overrides = {}) {
  return {
    id,
    exam_session_id: examSessionId,
    question_id: questionId,
    user_id: "user-1",
    subject: "Anatomy",
    is_correct: true,
    ...overrides
  };
}

function createMockSupabase(tables, options = {}) {
  const calls = [];
  const client = {
    calls,
    from(table) {
      const state = { table, fields: null, selectOptions: null, userId: null, orders: [] };
      const query = {
        select(fields, selectOptions) {
          state.fields = fields;
          state.selectOptions = selectOptions;
          return query;
        },
        eq(column, value) {
          assert.equal(column, "user_id");
          state.userId = value;
          return query;
        },
        order(column, orderOptions) {
          state.orders.push({ column, ...orderOptions });
          return query;
        },
        async range(from, to) {
          calls.push({ ...state, orders: state.orders.slice(), from, to });
          const failure = options.failures?.[table];
          if (failure) return { data: null, error: failure, count: null };
          if (options.resolvePage) {
            const custom = options.resolvePage({ table, from, to, call: calls.at(-1) });
            if (custom) return custom;
          }
          const rows = tables[table] || [];
          return {
            data: state.selectOptions?.head ? null : rows.slice(from, to + 1),
            error: null,
            count: state.selectOptions?.count === "exact"
              ? (options.omitCount ? null : rows.length)
              : null
          };
        }
      };
      return query;
    }
  };
  return client;
}

test("single-page loading selects required fields, user scope, and deterministic ordering", async () => {
  const client = createMockSupabase({
    exam_sessions: [session(1)],
    exam_session_questions: [question(10, 1, "q1")]
  });
  const result = await integration.loadStatisticsData(client, "user-1");

  assert.equal(result.complete, true);
  assert.equal(result.sessions.length, 1);
  assert.equal(result.questionRecords.length, 1);
  assert.equal(client.calls.length, 2);
  assert.ok(client.calls.every(call => call.userId === "user-1"));
  assert.deepEqual(client.calls[0].orders, [
    { column: "created_at", ascending: true },
    { column: "id", ascending: true }
  ]);
  assert.deepEqual(client.calls[1].orders, [
    { column: "exam_session_id", ascending: true },
    { column: "question_id", ascending: true },
    { column: "id", ascending: true }
  ]);
  assert.ok(client.calls[1].fields.includes("question_id"));
  assert.ok(client.calls[1].fields.includes("user_id"));
  assert.deepEqual(client.calls[0].selectOptions, { count: "exact" });
});

test("multi-page loading retrieves more than 1,000 question records", async () => {
  const questionRows = Array.from({ length: 1205 }, (_, index) =>
    question(index + 1, 1, `q-${index + 1}`, { is_correct: index % 2 === 0 })
  );
  const correct = questionRows.filter(row => row.is_correct).length;
  const client = createMockSupabase({
    exam_sessions: [session(1, { questions_total: 1205, correct, wrong: 1205 - correct })],
    exam_session_questions: questionRows
  });
  const result = await integration.loadStatisticsData(client, "user-1");

  assert.equal(result.questionRecords.length, 1205);
  const questionCalls = client.calls.filter(call => call.table === "exam_session_questions");
  const dataCalls = questionCalls.filter(call => !call.selectOptions?.head);
  assert.deepEqual(dataCalls.map(call => [call.from, call.to]), [
    [0, 499],
    [500, 999],
    [1000, 1499]
  ]);
  assert.equal(questionCalls.length, 4);
  assert.equal(questionCalls.filter(call => call.selectOptions?.count === "exact").length, 2);
  assert.equal(dataCalls.slice(1).every(call => call.selectOptions === undefined), true);
});

test("exact pagination boundaries stop after the last full page", async () => {
  const questionRows = Array.from({ length: 1000 }, (_, index) =>
    question(index + 1, 1, `q-${index + 1}`)
  );
  const client = createMockSupabase({
    exam_sessions: [session(1, { questions_total: 1000, correct: 1000 })],
    exam_session_questions: questionRows
  });
  const result = await integration.loadStatisticsData(client, "user-1");

  assert.equal(result.questionRecords.length, 1000);
  assert.equal(
    client.calls.filter(call => call.table === "exam_session_questions").length,
    3
  );
});

test("missing, null, and malformed initial exact counts fail closed", async t => {
  const invalidCounts = [
    ["missing", undefined],
    ["null", null],
    ["string", "1"],
    ["negative", -1],
    ["fractional", 1.5]
  ];

  for (const [name, count] of invalidCounts) {
    await t.test(name, async () => {
      const response = { data: [session(1)], error: null };
      if (name !== "missing") response.count = count;
      const client = createMockSupabase(
        { exam_sessions: [], exam_session_questions: [] },
        { resolvePage: ({ table }) => table === "exam_sessions" ? response : null }
      );
      await assert.rejects(
        integration.loadStatisticsData(client, "user-1"),
        error => error.code === "INVALID_EXACT_COUNT" && error.table === "exam_sessions"
      );
    });
  }
});

test("a changed final exact count rejects a concurrent multi-page dataset", async () => {
  const rows = [session(1), session(2), session(3)];
  const client = createMockSupabase(
    { exam_sessions: rows, exam_session_questions: [] },
    {
      resolvePage({ table, from, call }) {
        if (table !== "exam_sessions") return null;
        if (call.selectOptions?.head) return { data: null, error: null, count: 4 };
        return {
          data: rows.slice(from, from + 2),
          error: null,
          count: from === 0 ? 3 : null
        };
      }
    }
  );

  await assert.rejects(
    integration.loadStatisticsData(client, "user-1", { pageSize: 2 }),
    error => error.code === "COUNT_CHANGED_DURING_FETCH"
  );
});

test("missing final count metadata rejects a multi-page dataset", async () => {
  const rows = [session(1), session(2), session(3)];
  const client = createMockSupabase(
    { exam_sessions: rows, exam_session_questions: [] },
    {
      resolvePage({ table, from, call }) {
        if (table !== "exam_sessions") return null;
        if (call.selectOptions?.head) return { data: null, error: null, count: null };
        return {
          data: rows.slice(from, from + 2),
          error: null,
          count: from === 0 ? 3 : null
        };
      }
    }
  );

  await assert.rejects(
    integration.loadStatisticsData(client, "user-1", { pageSize: 2 }),
    error => error.code === "INVALID_EXACT_COUNT"
  );
});

test("overlapping pages are deduplicated by transport ID", async () => {
  const rows = [session(1), session(2), session(3)];
  const client = createMockSupabase(
    { exam_sessions: rows, exam_session_questions: [] },
    {
      resolvePage({ table, from }) {
        if (table !== "exam_sessions") return null;
        if (from === 0) return { data: [rows[0], rows[1]], error: null, count: 3 };
        if (from === 2) return { data: [rows[1], rows[2]], error: null, count: 3 };
        return { data: [], error: null, count: 3 };
      }
    }
  );
  const result = await integration.loadStatisticsData(client, "user-1", { pageSize: 2 });
  assert.deepEqual(result.sessions.map(item => item.id), [1, 2, 3]);
});

test("overlapping question pages do not duplicate analytics inputs", async () => {
  const rows = [
    question(1, 1, "q1"),
    question(2, 1, "q2", { is_correct: false }),
    question(3, 1, "q3")
  ];
  const client = createMockSupabase(
    {
      exam_sessions: [session(1, { questions_total: 3, correct: 2, wrong: 1 })],
      exam_session_questions: rows
    },
    {
      resolvePage({ table, from }) {
        if (table !== "exam_session_questions") return null;
        if (from === 0) return { data: [rows[0], rows[1]], error: null, count: 3 };
        if (from === 2) return { data: [rows[1], rows[2]], error: null, count: 3 };
        return { data: [], error: null, count: 3 };
      }
    }
  );
  const result = await integration.loadStatisticsData(client, "user-1", { pageSize: 2 });
  const view = integration.adaptAnalyticsToLegacyView(
    result.sessions,
    result.questionRecords,
    engine,
    { referenceTime: REFERENCE }
  );

  assert.equal(result.questionRecords.length, 3);
  assert.equal(view.subjectStats[0].questions, 3);
  assert.equal(view.subjectStats[0].correct, 2);
});

test("conflicting overlapping rows fail closed", async () => {
  const first = session(1);
  const changed = session(1, { correct: 0, wrong: 1, score: 0 });
  const client = createMockSupabase(
    { exam_sessions: [], exam_session_questions: [] },
    {
      resolvePage({ table }) {
        if (table === "exam_sessions") {
          return { data: [first, changed], error: null, count: 1 };
        }
        return null;
      }
    }
  );
  await assert.rejects(
    integration.loadStatisticsData(client, "user-1", { pageSize: 2 }),
    error => error.code === "CONFLICTING_PAGE_RECORD" && error.table === "exam_sessions"
  );
});

test("session retrieval failure is surfaced without partial data", async () => {
  const client = createMockSupabase(
    { exam_sessions: [], exam_session_questions: [] },
    { failures: { exam_sessions: new Error("session failure") } }
  );
  await assert.rejects(
    integration.loadStatisticsData(client, "user-1"),
    error => error.code === "PAGE_FETCH_FAILED" && error.table === "exam_sessions"
  );
  assert.equal(client.calls.some(call => call.table === "exam_session_questions"), false);
});

test("question-detail failure is surfaced rather than treated as missing details", async () => {
  const client = createMockSupabase(
    { exam_sessions: [session(1)], exam_session_questions: [] },
    { failures: { exam_session_questions: new Error("detail failure") } }
  );
  await assert.rejects(
    integration.loadStatisticsData(client, "user-1"),
    error => error.code === "PAGE_FETCH_FAILED" && error.table === "exam_session_questions"
  );
});

test("an incomplete page set is rejected", async () => {
  const client = createMockSupabase(
    { exam_sessions: [], exam_session_questions: [] },
    {
      resolvePage({ table }) {
        if (table === "exam_sessions") {
          return { data: [session(1)], error: null, count: 2 };
        }
        return null;
      }
    }
  );
  await assert.rejects(
    integration.loadStatisticsData(client, "user-1"),
    error => error.code === "INCOMPLETE_PAGE_SET"
  );
});

test("empty history returns complete empty datasets without a detail query", async () => {
  const client = createMockSupabase({ exam_sessions: [], exam_session_questions: [] });
  const result = await integration.loadStatisticsData(client, "user-1");

  assert.deepEqual(result, { sessions: [], questionRecords: [], complete: true });
  assert.deepEqual(client.calls.map(call => call.table), ["exam_sessions"]);
});

test("adapter preserves historical overall metrics while exposing missing detail coverage", () => {
  const sessions = [session(1, { questions_total: 10, correct: 7, wrong: 3, score: 70 })];
  const view = integration.adaptAnalyticsToLegacyView(sessions, [], engine, {
    referenceTime: REFERENCE
  });

  assert.equal(view.totalExams, 1);
  assert.equal(view.totalQuestions, 10);
  assert.equal(view.overallAccuracy, 70);
  assert.deepEqual(view.subjectStats, []);
  assert.equal(view.coverage.missingDetailSessions, 1);
  assert.equal(view.coverage.questionLevelAnalyzedSessions, 0);
});

test("percentage display cannot round exact weak-subject values across thresholds", () => {
  const belowFifty = { questions: 1000, accuracy: 49.999 };
  const atFifty = { questions: 10, accuracy: 50 };
  const sevenOfEleven = { questions: 11, accuracy: (7 / 11) * 100 };
  const atSixtyFour = { questions: 25, accuracy: (16 / 25) * 100 };

  assert.equal(integration.getWeakSubjectStatus(belowFifty), "weak");
  assert.equal(integration.formatPercentage(belowFifty.accuracy), "49.9%");
  assert.equal(integration.getWeakSubjectStatus(atFifty), "risk");
  assert.equal(integration.formatPercentage(atFifty.accuracy), "50%");
  assert.equal(integration.getWeakSubjectStatus(sevenOfEleven), "risk");
  assert.equal(integration.formatPercentage(sevenOfEleven.accuracy), "63.6%");
  assert.equal(integration.getWeakSubjectStatus(atSixtyFour), "strong");
  assert.equal(integration.formatPercentage(atSixtyFour.accuracy), "64%");
  assert.equal(integration.formatPercentage((29 / 100) * 100), "29%");
  assert.equal(integration.formatPercentage((57 / 100) * 100), "57%");
  assert.equal(integration.formatPercentage(49.999999), "49.9%");
  assert.equal(integration.formatPercentage(63.999999), "63.9%");
});

test("threshold distance preserves nonzero sub-tenth differences around 64%", () => {
  const immediatelyBelow = 63.9999;
  const immediatelyAbove = 64.0001;

  assert.equal(
    integration.formatThresholdDistance(immediatelyBelow),
    "Less than 0.1 percentage points below the 64% pass threshold"
  );
  assert.equal(
    integration.formatThresholdDistance(immediatelyAbove),
    "Less than 0.1 percentage points above the 64% pass threshold"
  );
  assert.equal(
    integration.formatThresholdDistance(64),
    "Exactly at the 64% pass threshold"
  );
  assert.equal(
    integration.getWeakSubjectStatus({ questions: 10, accuracy: immediatelyBelow }),
    "risk"
  );
  assert.equal(
    integration.getWeakSubjectStatus({ questions: 10, accuracy: immediatelyAbove }),
    "strong"
  );
});

test("adapter preserves genuine medical subjects from Past Paper detail rows", () => {
  const sessions = [session(1, {
    subject: "Past Paper 2023",
    questions_total: 2,
    correct: 1,
    wrong: 1,
    score: 50
  })];
  const questions = [
    question(11, 1, "past-a", { subject: "Anatomy", is_correct: true }),
    question(12, 1, "past-p", { subject: "Pharmacology", is_correct: false })
  ];
  const view = integration.adaptAnalyticsToLegacyView(sessions, questions, engine, {
    referenceTime: REFERENCE
  });

  assert.deepEqual(view.subjectStats.map(item => item.subject), ["Anatomy", "Pharmacology"]);
  assert.equal(view.coverage.questionLevelAnalyzedSessions, 1);
});

test("adapter exposes Past Paper metadata rows as unavailable attribution, not missing details", () => {
  const sessions = [session(1, {
    subject: "Past Paper 2023",
    questions_total: 2,
    correct: 1,
    wrong: 1,
    score: 50
  })];
  const questions = [
    question(11, 1, "2023-1", { subject: "Past Paper 2023", is_correct: true }),
    question(12, 1, "2023-2", { subject: "Past Paper 2023", is_correct: false })
  ];
  const view = integration.adaptAnalyticsToLegacyView(sessions, questions, engine, {
    referenceTime: REFERENCE
  });
  const coverage = view.coverage.byKrok[1];

  assert.equal(view.totalExams, 1);
  assert.equal(view.totalQuestions, 2);
  assert.equal(view.totalCorrect, 1);
  assert.deepEqual(view.subjectStats, []);
  assert.equal(view.coverage.missingDetailSessions, 0);
  assert.equal(view.coverage.unattributedSessions, 1);
  assert.equal(coverage.questionLevel.unattributedSessionCount, 1);
  assert.equal(coverage.sessions[0].subjectAttributionStatus, "unavailable");
  assert.equal(coverage.sessions[0].rawDetailRecordCount, 2);
});

test("progress uses validated PostgreSQL timestamps and canonical UTC ordering", () => {
  const sessions = [
    session("same-b", { created_at: "2026-01-30T22:00:00+02:00" }),
    session("invalid-calendar", { created_at: "2026-02-30T19:00:00+00" }),
    session("same-a", { created_at: "2026-01-30 20:00:00+00" }),
    session("earlier", { created_at: "2026-01-30T19:00:00+00" }),
    session("missing-zone", { created_at: "2026-01-30T18:00:00" })
  ];
  const view = integration.adaptAnalyticsToLegacyView(sessions, [], engine, {
    referenceTime: REFERENCE
  });

  assert.deepEqual(view.progress.map(item => item.id), ["earlier", "same-a", "same-b"]);
  assert.deepEqual(view.progress.map(item => item.createdAt), [
    "2026-01-30T19:00:00.000Z",
    "2026-01-30T20:00:00.000Z",
    "2026-01-30T20:00:00.000Z"
  ]);
  assert.ok(view.progress.every(item => Number.isFinite(item.createdAtTimestamp)));
});

test("adapter keeps KROK versions isolated and attributes complete All Topics details", () => {
  const sessions = [
    session(1, { subject: "All Topics", questions_total: 2, correct: 1, wrong: 1, score: 50 }),
    session(2, { krok: 2, subject: "Microbiology", questions_total: 1, correct: 1 }),
    session(3, { questions_total: 10, correct: 7, wrong: 3, score: 70 })
  ];
  const questions = [
    question(11, 1, "k1-a", { subject: "Anatomy", is_correct: true }),
    question(12, 1, "k1-p", { subject: "Normal Phisiology", is_correct: false }),
    question(21, 2, "k2-m", { subject: "Microbiology", is_correct: true })
  ];
  const view = integration.adaptAnalyticsToLegacyView(sessions, questions, engine, {
    referenceTime: REFERENCE
  });

  assert.equal(view.totalExams, 3);
  assert.equal(view.totalQuestions, 13);
  assert.equal(view.totalCorrect, 9);
  assert.equal(view.krok1.exams, 2);
  assert.equal(view.krok1.accuracy, (8 / 12) * 100);
  assert.equal(view.krok2.exams, 1);
  assert.equal(view.krok2.accuracy, 100);
  assert.deepEqual(view.subjectStats.map(item => item.subject).sort(), [
    "Anatomy",
    "Microbiology",
    "Normal Physiology"
  ]);
  assert.equal(view.coverage.byKrok[1].counts.missing, 1);
});

test("adapter returns the legacy renderer field names and exact internal accuracy", () => {
  const sessions = [session(1, { questions_total: 3, correct: 2, wrong: 1, score: 67 })];
  const questions = [
    question(1, 1, "q1", { is_correct: true }),
    question(2, 1, "q2", { is_correct: true }),
    question(3, 1, "q3", { is_correct: false })
  ];
  const view = integration.adaptAnalyticsToLegacyView(sessions, questions, engine, {
    referenceTime: REFERENCE
  });
  const subject = view.subjectStats[0];

  assert.deepEqual(Object.keys(subject).sort(), ["accuracy", "byKrok", "correct", "exams", "questions", "subject", "trend"]);
  assert.equal(subject.questions, 3);
  assert.equal(subject.correct, 2);
  assert.equal(subject.exams, 1);
  assert.equal(subject.accuracy, (2 / 3) * 100);
  assert.deepEqual(subject.byKrok.map(item => item.krok), [1]);
  assert.equal(view.progress[0].accuracy, (2 / 3) * 100);
});

test("adapter never combines KROK 1 and KROK 2 records to manufacture a subject trend", () => {
  const sessions = [
    session("k1", { created_at: "2026-01-10T12:00:00Z", krok: 1, subject: "Anatomy", questions_total: 20, correct: 10, wrong: 10 }),
    session("k2", { created_at: "2026-01-11T12:00:00Z", krok: 2, subject: "Anatomy", questions_total: 20, correct: 20, wrong: 0 })
  ];
  const questions = sessions.flatMap((item, sessionIndex) =>
    Array.from({ length: 20 }, (_, index) => question(
      `${item.id}-${index}`,
      item.id,
      `q-${index}`,
      { is_correct: sessionIndex === 1 || index < 10 }
    ))
  );
  const view = integration.adaptAnalyticsToLegacyView(sessions, questions, engine, {
    referenceTime: REFERENCE
  });

  assert.equal(view.subjectStats[0].questions, 40);
  assert.equal(view.subjectStats[0].trend.status, "insufficient_data");
  assert.equal(view.subjectStats[0].trend.differencePercentagePoints, null);
  assert.equal(view.subjectStats[0].trend.reason, "minimum_sample");
});

test("adapter keeps independently sufficient KROK subject trends separate", () => {
  const sessions = [
    session("k1", { created_at: "2026-01-10T12:00:00Z", krok: 1, questions_total: 40, correct: 30, wrong: 10 }),
    session("k2", { created_at: "2026-01-11T12:00:00Z", krok: 2, questions_total: 40, correct: 30, wrong: 10 })
  ];
  const questions = sessions.flatMap(item =>
    Array.from({ length: 40 }, (_, index) => question(
      `${item.id}-${index}`,
      item.id,
      `q-${String(index).padStart(2, "0")}`,
      { is_correct: index < 10 || index >= 20 }
    ))
  );
  const view = integration.adaptAnalyticsToLegacyView(sessions, questions, engine, {
    referenceTime: REFERENCE
  });

  assert.equal(view.subjectStats[0].trend.status, "insufficient_data");
  assert.equal(view.subjectStats[0].trend.reason, "separate_krok_histories");
});

test("adapter applies all four temporal filters to every view metric", () => {
  const definitions = [
    ["old", "2026-01-01T00:00:00Z", 1],
    ["at-90", "2026-10-03T00:00:00Z", 1],
    ["at-30", "2026-12-02T00:00:00Z", 1],
    ["at-7", "2026-12-25T00:00:00Z", 1],
    ["offset", "2027-01-01T01:00:00+02:00", 2],
    ["future", REFERENCE, 1],
    ["ambiguous", "2026-12-31T12:00:00", 1]
  ];
  const sessions = definitions.map(([id, created_at, krok]) => session(id, {
    created_at,
    krok,
    questions_total: 1,
    correct: 1,
    wrong: 0
  }));
  const questions = definitions.map(([id]) => question(`${id}-row`, id, `${id}-q`));
  const expected = new Map([
    [engine.TIME_FILTERS.ALL_TIME, 5],
    [engine.TIME_FILTERS.LAST_90_DAYS, 4],
    [engine.TIME_FILTERS.LAST_30_DAYS, 3],
    [engine.TIME_FILTERS.LAST_7_DAYS, 2]
  ]);

  for (const [filter, examCount] of expected) {
    const view = integration.adaptAnalyticsToLegacyView(sessions, questions, engine, {
      filter,
      referenceTime: REFERENCE
    });
    assert.equal(view.filter, filter);
    assert.equal(view.window.end, Date.parse(REFERENCE));
    assert.equal(view.totalExams, examCount);
    assert.equal(view.totalQuestions, examCount);
    assert.equal(view.progress.length, examCount);
    assert.equal(view.bestScore, 100);
    assert.equal(view.coverage.questionLevelAnalyzedSessions, examCount);
  }

  const implicitAllTime = integration.adaptAnalyticsToLegacyView(
    sessions,
    questions,
    engine,
    { referenceTime: REFERENCE }
  );
  const explicitAllTime = integration.adaptAnalyticsToLegacyView(
    sessions,
    questions,
    engine,
    { filter: engine.TIME_FILTERS.ALL_TIME, referenceTime: REFERENCE }
  );
  assert.deepEqual(implicitAllTime, explicitAllTime);
  assert.equal(explicitAllTime.krok1.exams, 4);
  assert.equal(explicitAllTime.krok2.exams, 1);
});

test("period views preserve missing-detail KPIs and return a complete empty period", () => {
  const sessions = [session("historical", {
    created_at: "2026-12-15T12:00:00Z",
    questions_total: 10,
    correct: 7,
    wrong: 3,
    score: 70
  })];
  const withinThirty = integration.adaptAnalyticsToLegacyView(sessions, [], engine, {
    filter: engine.TIME_FILTERS.LAST_30_DAYS,
    referenceTime: REFERENCE
  });
  const withinSeven = integration.adaptAnalyticsToLegacyView(sessions, [], engine, {
    filter: engine.TIME_FILTERS.LAST_7_DAYS,
    referenceTime: REFERENCE
  });

  assert.equal(withinThirty.totalExams, 1);
  assert.equal(withinThirty.totalQuestions, 10);
  assert.equal(withinThirty.overallAccuracy, 70);
  assert.deepEqual(withinThirty.subjectStats, []);
  assert.equal(withinThirty.coverage.missingDetailSessions, 1);
  assert.equal(withinSeven.totalExams, 0);
  assert.equal(withinSeven.totalQuestions, 0);
  assert.equal(withinSeven.overallAccuracy, null);
  assert.equal(withinSeven.bestScore, null);
  assert.deepEqual(withinSeven.progress, []);
  assert.equal(withinSeven.coverage.missingDetailSessions, 0);
});

test("period subject classification keeps the exact nine-versus-ten question boundary", () => {
  const exam = session("boundary", {
    created_at: "2026-12-30T12:00:00Z",
    subject: "All Topics",
    questions_total: 19,
    correct: 19,
    wrong: 0
  });
  const questions = Array.from({ length: 19 }, (_, index) => question(
    `boundary-${index}`,
    "boundary",
    `q-${index}`,
    { subject: index < 9 ? "Anatomy" : "Histology" }
  ));
  const view = integration.adaptAnalyticsToLegacyView([exam], questions, engine, {
    filter: engine.TIME_FILTERS.LAST_7_DAYS,
    referenceTime: REFERENCE
  });
  const bySubject = Object.fromEntries(view.subjectStats.map(item => [item.subject, item]));

  assert.equal(integration.getWeakSubjectStatus(bySubject.Anatomy), "insufficient");
  assert.equal(integration.getWeakSubjectStatus(bySubject.Histology), "strong");
});

test("subject trends are recalculated from only the selected period", () => {
  const sessions = [
    session("older", {
      created_at: "2026-11-01T12:00:00Z",
      questions_total: 20,
      correct: 0,
      wrong: 20
    }),
    session("recent", {
      created_at: "2026-12-30T12:00:00Z",
      questions_total: 20,
      correct: 20,
      wrong: 0
    })
  ];
  const questions = sessions.flatMap(item => Array.from({ length: 20 }, (_, index) => question(
    `${item.id}-${index}`,
    item.id,
    `q-${index}`,
    { is_correct: item.id === "recent" }
  )));
  const allTime = integration.adaptAnalyticsToLegacyView(sessions, questions, engine, {
    filter: engine.TIME_FILTERS.ALL_TIME,
    referenceTime: REFERENCE
  });
  const lastSeven = integration.adaptAnalyticsToLegacyView(sessions, questions, engine, {
    filter: engine.TIME_FILTERS.LAST_7_DAYS,
    referenceTime: REFERENCE
  });

  assert.equal(allTime.subjectStats[0].trend.status, "improving");
  assert.equal(allTime.subjectStats[0].trend.differencePercentagePoints, 100);
  assert.equal(lastSeven.subjectStats[0].trend.status, "insufficient_data");
  assert.equal(lastSeven.subjectStats[0].trend.differencePercentagePoints, null);
});

test("subject detail contract is KROK-specific, exact, and coverage-transparent", () => {
  const sessions = [
    session("k1-complete", { created_at: "2026-12-30T10:00:00Z", subject: "All Topics", questions_total: 3, correct: 2, wrong: 1 }),
    session("k1-missing", { created_at: "2026-12-30T11:00:00Z", questions_total: 10, correct: 7, wrong: 3 }),
    session("k2-complete", { created_at: "2026-12-30T12:00:00Z", krok: 2, questions_total: 1, correct: 1, wrong: 0 })
  ];
  const questions = [
    question("k1-a1", "k1-complete", "a1", { subject: "Anatomy", is_correct: true }),
    question("k1-a2", "k1-complete", "a2", { subject: "Anatomy", is_correct: false }),
    question("k1-p1", "k1-complete", "p1", { subject: "Normal Phisiology", is_correct: true }),
    question("k2-a1", "k2-complete", "a1", { subject: "Anatomy", is_correct: true })
  ];

  const detail = integration.adaptSubjectDetailView(sessions, questions, engine, {
    subject: "Anatomy",
    krok: 1,
    filter: engine.TIME_FILTERS.LAST_7_DAYS,
    referenceTime: REFERENCE
  });
  const krok2 = integration.adaptSubjectDetailView(sessions, questions, engine, {
    subject: "Anatomy",
    krok: 2,
    filter: engine.TIME_FILTERS.LAST_7_DAYS,
    referenceTime: REFERENCE
  });

  assert.equal(detail.subject, "Anatomy");
  assert.equal(detail.krok, 1);
  assert.equal(detail.questionCount, 2);
  assert.equal(detail.correctCount, 1);
  assert.equal(detail.examCount, 1);
  assert.equal(detail.accuracy, 50);
  assert.equal(detail.thresholdDistance, "14 percentage points below the 64% pass threshold");
  assert.equal(detail.classification, "insufficient");
  assert.equal(detail.trend.krok, 1);
  assert.deepEqual(detail.series.map(item => [item.sessionId, item.correctCount, item.questionCount]), [
    ["k1-complete", 1, 2]
  ]);
  assert.equal(detail.periodCoverage.selectedSessionCount, 2);
  assert.equal(detail.periodCoverage.analyzedSessionCount, 1);
  assert.equal(detail.periodCoverage.missingDetailSessionCount, 1);
  assert.equal(krok2.questionCount, 1);
  assert.equal(krok2.accuracy, 100);
});

test("subject detail returns explicit null and insufficient states for an empty period", () => {
  const detail = integration.adaptSubjectDetailView([
    session("historical", { created_at: "2026-01-01T12:00:00Z" })
  ], [
    question("historical-row", "historical", "q1")
  ], engine, {
    subject: "Normal Phisiology",
    krok: 1,
    filter: engine.TIME_FILTERS.LAST_7_DAYS,
    referenceTime: REFERENCE
  });

  assert.equal(detail.subject, "Normal Physiology");
  assert.equal(detail.accuracy, null);
  assert.equal(detail.questionCount, 0);
  assert.equal(detail.examCount, 0);
  assert.equal(detail.thresholdDistance, "—");
  assert.equal(detail.classification, "insufficient");
  assert.equal(detail.trend.status, "insufficient_data");
  assert.equal(detail.trend.krok, 1);
  assert.deepEqual(detail.series, []);
});

test("period switching caches four views without issuing additional Supabase queries", async () => {
  const client = createMockSupabase({
    exam_sessions: [session(1, { created_at: "2026-12-30T12:00:00Z" })],
    exam_session_questions: [question(1, 1, "q1")]
  });
  const data = await integration.loadStatisticsData(client, "user-1");
  const callsAfterLoad = client.calls.length;
  const store = pageController.createPeriodViewStore({
    data,
    engine,
    integration,
    referenceTime: Date.parse(REFERENCE)
  });
  const originalAllTime = store.getView(engine.TIME_FILTERS.ALL_TIME);

  store.getView(engine.TIME_FILTERS.LAST_90_DAYS);
  store.getView(engine.TIME_FILTERS.LAST_30_DAYS);
  store.getView(engine.TIME_FILTERS.LAST_7_DAYS);
  store.getView(engine.TIME_FILTERS.LAST_30_DAYS);
  const restoredAllTime = store.getView(engine.TIME_FILTERS.ALL_TIME);

  assert.equal(client.calls.length, callsAfterLoad);
  assert.equal(store.cachedViewCount, 4);
  assert.strictEqual(restoredAllTime, originalAllTime);
  assert.equal(restoredAllTime.window.end, Date.parse(REFERENCE));
});

test("subject detail cache is isolated by period, normalized subject, and KROK without new queries", async () => {
  const client = createMockSupabase({
    exam_sessions: [session(1, { created_at: "2026-12-30T12:00:00Z" })],
    exam_session_questions: [question(1, 1, "q1")]
  });
  const data = await integration.loadStatisticsData(client, "user-1");
  const callsAfterLoad = client.calls.length;
  const store = pageController.createPeriodViewStore({
    data,
    engine,
    integration,
    referenceTime: Date.parse(REFERENCE)
  });
  const original = store.getSubjectView(
    engine.TIME_FILTERS.ALL_TIME,
    "Normal Phisiology",
    1
  );
  const aliasHit = store.getSubjectView(
    engine.TIME_FILTERS.ALL_TIME,
    "Normal Physiology",
    1
  );
  store.getSubjectView(engine.TIME_FILTERS.LAST_7_DAYS, "Normal Physiology", 1);
  store.getSubjectView(engine.TIME_FILTERS.ALL_TIME, "Normal Physiology", 2);
  store.getSubjectView(engine.TIME_FILTERS.ALL_TIME, "Anatomy", 1);

  assert.strictEqual(aliasHit, original);
  assert.equal(store.cachedSubjectViewCount, 4);
  assert.equal(client.calls.length, callsAfterLoad);
  assert.equal(store.cachedViewCount, 0);
});

test("view navigation preserves the selected period and returns to the dashboard", () => {
  const navigator = pageController.createViewNavigator({
    engine,
    initialFilter: engine.TIME_FILTERS.ALL_TIME
  });
  navigator.openSubject("Normal Phisiology", 2);
  const filtered = navigator.selectFilter(engine.TIME_FILTERS.LAST_30_DAYS);
  assert.deepEqual(filtered, {
    mode: "subject",
    filter: engine.TIME_FILTERS.LAST_30_DAYS,
    subject: "Normal Physiology",
    krok: 2
  });
  assert.deepEqual(navigator.showDashboard(), {
    mode: "dashboard",
    filter: engine.TIME_FILTERS.LAST_30_DAYS,
    subject: null,
    krok: null
  });
});

test("chart updates reuse a single Chart.js instance", () => {
  let constructions = 0;
  class FakeChart {
    constructor(canvas, config) {
      constructions += 1;
      this.canvas = canvas;
      this.data = config.data;
      this.options = config.options;
      this.updateCount = 0;
    }
    update() { this.updateCount += 1; }
  }
  const canvas = {};
  const firstConfig = { data: { labels: ["A"], datasets: [{ data: [50] }] }, options: {} };
  const secondConfig = { data: { labels: ["B"], datasets: [{ data: [75] }] }, options: {} };
  const first = pageController.updateChartInstance(null, FakeChart, canvas, firstConfig);
  const second = pageController.updateChartInstance(first, FakeChart, canvas, secondConfig);

  assert.strictEqual(second, first);
  assert.equal(constructions, 1);
  assert.equal(second.updateCount, 1);
  assert.deepEqual(second.data, secondConfig.data);
});

test("dashboard and subject charts retain independent single instances", () => {
  let constructions = 0;
  class FakeChart {
    constructor(canvas, config) {
      constructions += 1;
      this.canvas = canvas;
      this.data = config.data;
      this.options = config.options;
      this.updateCount = 0;
    }
    update() { this.updateCount += 1; }
  }
  const config = { data: { labels: [], datasets: [] }, options: {} };
  let dashboard = pageController.updateChartInstance(null, FakeChart, { id: "dashboard" }, config);
  let subject = pageController.updateChartInstance(null, FakeChart, { id: "subject" }, config);
  dashboard = pageController.updateChartInstance(dashboard, FakeChart, dashboard.canvas, config);
  subject = pageController.updateChartInstance(subject, FakeChart, subject.canvas, config);

  assert.equal(constructions, 2);
  assert.equal(dashboard.updateCount, 1);
  assert.equal(subject.updateCount, 1);
  assert.notStrictEqual(dashboard, subject);
});
