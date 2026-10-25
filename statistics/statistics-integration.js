/**
 * Supabase loading and legacy Statistics view adaptation.
 *
 * The loader fails closed: callers receive no partial dataset if a page fails,
 * a count changes, a row lacks its transport identity, or pagination ends
 * before the exact server count is reached.
 */
(function attachStatisticsIntegration(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StatisticsIntegration = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createIntegration() {
  "use strict";

  const DEFAULT_PAGE_SIZE = 500;
  const MAX_PAGES = 10000;
  const WEAK_SUBJECT_MIN_QUESTIONS = 10;
  const KROK_PASS_THRESHOLD = 64;
  const SESSION_FIELDS = Object.freeze([
    "id",
    "user_id",
    "created_at",
    "krok",
    "mode",
    "subject",
    "questions_total",
    "correct",
    "wrong",
    "score"
  ]);
  const QUESTION_FIELDS = Object.freeze([
    "id",
    "exam_session_id",
    "question_id",
    "user_id",
    "subject",
    "is_correct"
  ]);

  class StatisticsDataError extends Error {
    constructor(message, details) {
      super(message);
      this.name = "StatisticsDataError";
      this.code = details?.code || "STATISTICS_DATA_ERROR";
      this.table = details?.table || null;
      this.cause = details?.cause;
    }
  }

  function positiveInteger(value, fallback) {
    if (value === undefined) return fallback;
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  function transportId(value) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return null;
  }

  function rowSignature(row, fields) {
    return JSON.stringify(fields.map(field => row[field]));
  }

  function exactCount(response, table) {
    if (!response || !Number.isSafeInteger(response.count) || response.count < 0) {
      throw new StatisticsDataError(`Invalid or missing count while loading ${table}.`, {
        code: "INVALID_EXACT_COUNT",
        table
      });
    }
    return response.count;
  }

  async function verifyFinalCount(client, config, expectedCount) {
    let response;
    try {
      response = await client
        .from(config.table)
        .select("id", { count: "exact", head: true })
        .eq("user_id", config.userId)
        .range(0, 0);
    } catch (cause) {
      throw new StatisticsDataError(`Unable to verify ${config.table}.`, {
        code: "COUNT_VERIFICATION_FAILED",
        table: config.table,
        cause
      });
    }
    if (!response || response.error) {
      throw new StatisticsDataError(`Unable to verify ${config.table}.`, {
        code: "COUNT_VERIFICATION_FAILED",
        table: config.table,
        cause: response?.error
      });
    }
    const finalCount = exactCount(response, config.table);
    if (finalCount !== expectedCount) {
      throw new StatisticsDataError(`Count changed while loading ${config.table}.`, {
        code: "COUNT_CHANGED_DURING_FETCH",
        table: config.table
      });
    }
  }

  async function fetchPaginatedTable(client, config) {
    if (!client || typeof client.from !== "function") {
      throw new TypeError("A Supabase-compatible client is required");
    }
    const pageSize = positiveInteger(config.pageSize, DEFAULT_PAGE_SIZE);
    if (pageSize === null) throw new TypeError("pageSize must be a positive integer");
    const recordsById = new Map();
    let expectedCount = null;
    let offset = 0;
    let completed = false;
    let pagesFetched = 0;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const tableQuery = client.from(config.table);
      let query = page === 0
        ? tableQuery.select(config.fields.join(","), { count: "exact" })
        : tableQuery.select(config.fields.join(","));
      query = query.eq("user_id", config.userId);
      for (const order of config.order) {
        query = query.order(order.column, { ascending: order.ascending });
      }
      let response;
      try {
        response = await query.range(offset, offset + pageSize - 1);
      } catch (cause) {
        throw new StatisticsDataError(`Unable to load ${config.table}.`, {
          code: "PAGE_FETCH_FAILED",
          table: config.table,
          cause
        });
      }
      if (!response || response.error) {
        throw new StatisticsDataError(`Unable to load ${config.table}.`, {
          code: "PAGE_FETCH_FAILED",
          table: config.table,
          cause: response?.error
        });
      }
      if (!Array.isArray(response.data)) {
        throw new StatisticsDataError(`Invalid response while loading ${config.table}.`, {
          code: "INVALID_PAGE_RESPONSE",
          table: config.table
        });
      }
      pagesFetched += 1;
      if (page === 0) {
        expectedCount = exactCount(response, config.table);
      } else if (response.count !== null && response.count !== undefined) {
        const intermediateCount = exactCount(response, config.table);
        if (intermediateCount !== expectedCount) {
          throw new StatisticsDataError(`Count changed while loading ${config.table}.`, {
            code: "COUNT_CHANGED_DURING_FETCH",
            table: config.table
          });
        }
      }

      for (const row of response.data) {
        if (!row || typeof row !== "object" || Array.isArray(row)) {
          throw new StatisticsDataError(`Malformed row while loading ${config.table}.`, {
            code: "MALFORMED_ROW",
            table: config.table
          });
        }
        const id = transportId(row.id);
        if (id === null) {
          throw new StatisticsDataError(`Missing row identity while loading ${config.table}.`, {
            code: "MISSING_TRANSPORT_ID",
            table: config.table
          });
        }
        const signature = rowSignature(row, config.fields);
        const existing = recordsById.get(id);
        if (existing && existing.signature !== signature) {
          throw new StatisticsDataError(`Conflicting page data while loading ${config.table}.`, {
            code: "CONFLICTING_PAGE_RECORD",
            table: config.table
          });
        }
        if (!existing) recordsById.set(id, { row, signature });
      }

      if (recordsById.size > expectedCount) {
        throw new StatisticsDataError(`Result exceeded count while loading ${config.table}.`, {
          code: "EXACT_COUNT_EXCEEDED",
          table: config.table
        });
      }

      if (recordsById.size === expectedCount) {
        completed = true;
        break;
      }
      if (response.data.length < pageSize) {
        if (recordsById.size !== expectedCount) {
          throw new StatisticsDataError(`Incomplete result while loading ${config.table}.`, {
            code: "INCOMPLETE_PAGE_SET",
            table: config.table
          });
        }
        completed = true;
        break;
      }
      offset += pageSize;
    }

    if (!completed) {
      throw new StatisticsDataError(`Pagination limit reached for ${config.table}.`, {
        code: "PAGINATION_LIMIT_REACHED",
        table: config.table
      });
    }
    if (recordsById.size !== expectedCount) {
      throw new StatisticsDataError(`Incomplete result while loading ${config.table}.`, {
        code: "INCOMPLETE_PAGE_SET",
        table: config.table
      });
    }
    if (pagesFetched > 1) {
      await verifyFinalCount(client, config, expectedCount);
    }
    return Array.from(recordsById.values(), item => item.row);
  }

  async function loadStatisticsData(client, userId, options) {
    const normalizedUserId = transportId(userId);
    if (normalizedUserId === null) throw new TypeError("A valid authenticated user ID is required");
    const pageSize = options?.pageSize;
    const sessions = await fetchPaginatedTable(client, {
      table: "exam_sessions",
      fields: SESSION_FIELDS,
      userId: normalizedUserId,
      pageSize,
      order: [
        { column: "created_at", ascending: true },
        { column: "id", ascending: true }
      ]
    });
    if (sessions.length === 0) {
      return { sessions: [], questionRecords: [], complete: true };
    }
    const questionRecords = await fetchPaginatedTable(client, {
      table: "exam_session_questions",
      fields: QUESTION_FIELDS,
      userId: normalizedUserId,
      pageSize,
      order: [
        { column: "exam_session_id", ascending: true },
        { column: "question_id", ascending: true },
        { column: "id", ascending: true }
      ]
    });
    return { sessions, questionRecords, complete: true };
  }

  function validMetricSession(session, parseTimestamp) {
    if (!session || typeof session !== "object") return null;
    const integer = value => {
      if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
      if (typeof value !== "string" || !/^[+-]?\d+$/.test(value.trim())) return null;
      const number = Number(value.trim());
      return Number.isSafeInteger(number) ? number : null;
    };
    const questions = integer(session.questions_total);
    const correct = integer(session.correct);
    const createdAtTimestamp = parseTimestamp(session.created_at);
    if (
      questions === null ||
      correct === null ||
      createdAtTimestamp === null ||
      questions <= 0 ||
      correct < 0 ||
      correct > questions
    ) return null;
    return {
      session,
      questions,
      correct,
      createdAtTimestamp,
      accuracy: (correct / questions) * 100
    };
  }

  function formatPercentage(value, emptyValue = "—") {
    if (value === null || !Number.isFinite(value)) return emptyValue;
    const scaled = value * 10;
    const nearestInteger = Math.round(scaled);
    const artifactSafeScaled = Math.abs(scaled - nearestInteger) < 1e-9
      ? nearestInteger
      : Math.trunc(scaled);
    const truncated = artifactSafeScaled / 10;
    return `${Number.isInteger(truncated) ? truncated.toFixed(0) : truncated.toFixed(1)}%`;
  }

  function formatThresholdDistance(accuracy, threshold = KROK_PASS_THRESHOLD) {
    if (!Number.isFinite(accuracy) || !Number.isFinite(threshold)) return "—";
    if (accuracy === threshold) return `Exactly at the ${threshold}% pass threshold`;
    const direction = accuracy < threshold ? "below" : "above";
    const distance = Math.abs(accuracy - threshold);
    if (distance < 0.1) {
      return `Less than 0.1 percentage points ${direction} the ${threshold}% pass threshold`;
    }
    return `${formatPercentage(distance).replace("%", "")} percentage points ${direction} the ${threshold}% pass threshold`;
  }

  function getWeakSubjectStatus(stat) {
    if (!stat || stat.questions < WEAK_SUBJECT_MIN_QUESTIONS) return "insufficient";
    if (stat.accuracy < 50) return "weak";
    if (stat.accuracy < KROK_PASS_THRESHOLD) return "risk";
    return "strong";
  }

  function mergeSubjects(subjectGroups, trendGroups) {
    const merged = new Map();
    for (const subjects of subjectGroups) {
      for (const subject of subjects) {
        if (!merged.has(subject.subject)) {
          merged.set(subject.subject, {
            subject: subject.subject,
            questions: 0,
            correct: 0,
            exams: 0
          });
        }
        const item = merged.get(subject.subject);
        item.questions += subject.questionCount;
        item.correct += subject.correctCount;
        item.exams += subject.sessionCount;
      }
    }
    const trendsBySubject = new Map();
    trendGroups.forEach((subjects, index) => {
      for (const trend of subjects) {
        if (!trendsBySubject.has(trend.subject)) trendsBySubject.set(trend.subject, []);
        trendsBySubject.get(trend.subject).push({ ...trend, krok: index + 1 });
      }
    });
    return Array.from(merged.values(), item => {
      const trends = trendsBySubject.get(item.subject) || [];
      const eligibleTrends = trends.filter(trend => trend.status !== "insufficient_data");
      const trend = eligibleTrends.length === 1
        ? eligibleTrends[0]
        : {
            status: "insufficient_data",
            differencePercentagePoints: null,
            krok: trends.length === 1 ? trends[0].krok : null,
            reason: eligibleTrends.length > 1 ? "separate_krok_histories" : "minimum_sample"
          };
      return {
        ...item,
        accuracy: item.questions > 0 ? (item.correct / item.questions) * 100 : null,
        trend
      };
    }).sort((left, right) =>
      right.accuracy - left.accuracy || right.questions - left.questions ||
      left.subject.localeCompare(right.subject, "en")
    );
  }

  function adaptAnalyticsToLegacyView(sessions, questionRecords, engine, options) {
    if (
      !engine ||
      typeof engine.buildAnalytics !== "function" ||
      typeof engine.parseTimestamp !== "function" ||
      typeof engine.getTimeWindow !== "function"
    ) {
      throw new TypeError("The KROK analytics engine is required");
    }
    const referenceTime = options?.referenceTime === undefined
      ? Date.now()
      : options.referenceTime;
    const filter = options?.filter || engine.TIME_FILTERS.ALL_TIME;
    engine.getTimeWindow(filter, referenceTime);
    const analyticsOptions = { referenceTime, filter };
    const byKrok = {
      1: engine.buildAnalytics(sessions, questionRecords, { krok: 1, ...analyticsOptions }),
      2: engine.buildAnalytics(sessions, questionRecords, { krok: 2, ...analyticsOptions })
    };
    const totalQuestions = byKrok[1].overall.questionCount + byKrok[2].overall.questionCount;
    const totalCorrect = byKrok[1].overall.correctCount + byKrok[2].overall.correctCount;
    const totalExams = byKrok[1].overall.sessionCount + byKrok[2].overall.sessionCount;
    const overallAccuracy = totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : null;

    const visibleSessions = [1, 2].flatMap(krok =>
      engine.filterSessionsByTime(sessions, filter, {
        krok,
        referenceTime
      })
    );
    const progress = visibleSessions
      .map(session => validMetricSession(session, engine.parseTimestamp))
      .filter(Boolean)
      .sort((left, right) => {
        const timeDifference = left.createdAtTimestamp - right.createdAtTimestamp;
        if (timeDifference !== 0) return timeDifference;
        return String(left.session.id).localeCompare(String(right.session.id), "en", { numeric: true });
      });
    const bestScore = progress.length
      ? Math.max(...progress.map(item => item.accuracy))
      : null;

    return {
      filter,
      window: byKrok[1].overall.window,
      totalExams,
      totalQuestions,
      totalCorrect,
      overallAccuracy,
      bestScore,
      krok1: {
        exams: byKrok[1].overall.sessionCount,
        accuracy: byKrok[1].overall.accuracy
      },
      krok2: {
        exams: byKrok[2].overall.sessionCount,
        accuracy: byKrok[2].overall.accuracy
      },
      subjectStats: mergeSubjects([
        byKrok[1].subjects.subjects,
        byKrok[2].subjects.subjects
      ], [
        byKrok[1].subjectTrends.subjects,
        byKrok[2].subjectTrends.subjects
      ]),
      progress: progress.map(item => ({
        id: item.session.id,
        createdAt: new Date(item.createdAtTimestamp).toISOString(),
        createdAtTimestamp: item.createdAtTimestamp,
        accuracy: item.accuracy
      })),
      coverage: {
        byKrok: {
          1: byKrok[1].coverage,
          2: byKrok[2].coverage
        },
        questionLevelAnalyzedSessions:
          byKrok[1].coverage.questionLevel.analyzedSessionCount +
          byKrok[2].coverage.questionLevel.analyzedSessionCount,
        missingDetailSessions:
          byKrok[1].coverage.questionLevel.missingDetailSessionCount +
          byKrok[2].coverage.questionLevel.missingDetailSessionCount,
        unattributedSessions:
          byKrok[1].coverage.questionLevel.unattributedSessionCount +
          byKrok[2].coverage.questionLevel.unattributedSessionCount
      }
    };
  }

  return Object.freeze({
    DEFAULT_PAGE_SIZE,
    WEAK_SUBJECT_MIN_QUESTIONS,
    KROK_PASS_THRESHOLD,
    SESSION_FIELDS,
    QUESTION_FIELDS,
    StatisticsDataError,
    fetchPaginatedTable,
    loadStatisticsData,
    formatPercentage,
    formatThresholdDistance,
    getWeakSubjectStatus,
    adaptAnalyticsToLegacyView
  });
});
