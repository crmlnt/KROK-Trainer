/**
 * Pure analytics for persisted KROK Exam Mode records.
 *
 * Time windows use session created_at and are half-open: [start, end). The
 * injected referenceTime is the exclusive end. Date-only strings mean UTC
 * midnight; date-times must carry an explicit PostgreSQL/ISO timezone.
 *
 * Question accuracy trusts only the stored boolean is_correct. It never
 * derives an incorrect attempt from an empty user_answer. Question analytics
 * require complete details that agree with their parent session.
 *
 * Empty zero-question sessions are "not_applicable" coverage, not complete,
 * and never count as meaningful performance sessions. Missing detail rows are
 * "missing" (their cause is unknown); contradictory rows are "inconsistent".
 *
 * Ownership fields may be omitted by projections or synthetic fixtures. When
 * both session and detail user_id are present, they must be valid and equal.
 */
(function attachAnalyticsEngine(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.KrokAnalytics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createAnalyticsEngine() {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const COMPARISON_EPSILON = 1e-12;
  const COVERAGE_STATUSES = Object.freeze([
    "complete",
    "missing",
    "partial",
    "unknown",
    "inconsistent",
    "not_applicable"
  ]);
  const TIME_FILTERS = Object.freeze({
    LAST_7_DAYS: "last_7_days",
    LAST_30_DAYS: "last_30_days",
    LAST_90_DAYS: "last_90_days",
    ALL_TIME: "all_time"
  });
  const FILTER_DAYS = Object.freeze({
    [TIME_FILTERS.LAST_7_DAYS]: 7,
    [TIME_FILTERS.LAST_30_DAYS]: 30,
    [TIME_FILTERS.LAST_90_DAYS]: 90
  });
  const SUBJECT_ALIASES = Object.freeze({
    "Normal Phisiology": "Normal Physiology"
  });
  const DEFAULT_COMPARISON_OPTIONS = Object.freeze({
    days: 30,
    minimumQuestions: 30,
    stableThresholdPercentagePoints: 1
  });
  const DEFAULT_SUBJECT_TREND_OPTIONS = Object.freeze({
    minimumQuestionsPerHalf: 20,
    changeThresholdPercentagePoints: 5
  });
  const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?))?$/i;
  const PAST_PAPER_METADATA_PATTERN = /^Past Paper \d{4}$/;

  function daysInMonth(year, month) {
    if (month === 2) {
      const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      return leap ? 29 : 28;
    }
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
  }

  function parseOffsetMinutes(value) {
    if (value.toUpperCase() === "Z") return 0;
    const sign = value[0] === "-" ? -1 : 1;
    const digits = value.slice(1).replace(":", "");
    const hours = Number(digits.slice(0, 2));
    const minutes = digits.length === 2 ? 0 : Number(digits.slice(2));
    if (hours > 15 || minutes > 59) return null;
    return sign * (hours * 60 + minutes);
  }

  function parseTimestamp(value) {
    if (value instanceof Date) {
      const timestamp = value.getTime();
      return Number.isFinite(timestamp) ? timestamp : null;
    }
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string" || value.trim() === "") return null;

    const match = TIMESTAMP_PATTERN.exec(value.trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
    if (match[4] === undefined) return Date.UTC(year, month - 1, day);

    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    if (hour > 23 || minute > 59 || second > 59) return null;
    const offsetMinutes = parseOffsetMinutes(match[8]);
    if (offsetMinutes === null) return null;
    const milliseconds = Number((match[7] || "").padEnd(3, "0").slice(0, 3));
    return Date.UTC(year, month - 1, day, hour, minute, second, milliseconds) -
      offsetMinutes * 60 * 1000;
  }

  function requireReferenceTime(value) {
    const timestamp = parseTimestamp(value === undefined ? Date.now() : value);
    if (timestamp === null) {
      throw new TypeError("referenceTime must be a valid timezone-qualified timestamp");
    }
    return timestamp;
  }

  function integerValue(value) {
    if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
    if (typeof value !== "string" || value.trim() === "") return null;
    if (!/^[+-]?\d+$/.test(value.trim())) return null;
    const number = Number(value.trim());
    return Number.isSafeInteger(number) ? number : null;
  }

  function nonnegativeInteger(value) {
    const number = integerValue(value);
    return number !== null && number >= 0 ? number : null;
  }

  function finiteNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string" || value.trim() === "") return null;
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) return null;
    const number = Number(value.trim());
    return Number.isFinite(number) ? number : null;
  }

  function requireKrok(value) {
    const krok = integerValue(value);
    if (krok !== 1 && krok !== 2) throw new TypeError("krok must be either 1 or 2");
    return krok;
  }

  function identifier(value) {
    if (typeof value === "string") {
      const id = value.trim();
      return id === "" ? null : id;
    }
    if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
    return null;
  }

  function ownership(value) {
    if (value === undefined || value === null) return { state: "omitted", value: null };
    const id = identifier(value);
    return id === null
      ? { state: "invalid", value: null }
      : { state: "present", value: id };
  }

  function isExamMode(value) {
    return typeof value === "string" && value.trim().toLowerCase() === "exam";
  }

  function normalizeSubject(subject) {
    if (typeof subject !== "string") return null;
    const original = subject.trim();
    if (!original) return null;
    return SUBJECT_ALIASES[original] || original;
  }

  function isMetadataSubject(subject) {
    if (typeof subject !== "string") return false;
    const normalized = subject.trim();
    return normalized.toLowerCase() === "all topics" ||
      PAST_PAPER_METADATA_PATTERN.test(normalized);
  }

  function getTimeWindow(filter, referenceTime) {
    const end = requireReferenceTime(referenceTime);
    if (filter === TIME_FILTERS.ALL_TIME) return Object.freeze({ filter, start: null, end });
    const days = FILTER_DAYS[filter];
    if (!days) throw new TypeError(`Unknown time filter: ${String(filter)}`);
    return Object.freeze({ filter, start: end - days * DAY_MS, end });
  }

  function timestampInWindow(timestamp, window) {
    return timestamp < window.end && (window.start === null || timestamp >= window.start);
  }

  function sessionSignature(record) {
    const owner = ownership(record.user_id);
    const signatureField = (raw, parsed) => parsed === null
      ? ["invalid", Array.isArray(raw) ? "array" : typeof raw, String(raw)]
      : ["valid", parsed];
    return JSON.stringify([
      signatureField(record.created_at, parseTimestamp(record.created_at)),
      signatureField(record.krok, integerValue(record.krok)),
      typeof record.mode === "string"
        ? ["valid", record.mode.trim().toLowerCase()]
        : ["invalid", Array.isArray(record.mode) ? "array" : typeof record.mode],
      typeof record.subject === "string"
        ? ["valid", record.subject.trim()]
        : ["invalid", Array.isArray(record.subject) ? "array" : typeof record.subject],
      signatureField(record.questions_total, nonnegativeInteger(record.questions_total)),
      signatureField(record.correct, nonnegativeInteger(record.correct)),
      signatureField(record.wrong, nonnegativeInteger(record.wrong)),
      signatureField(record.score, finiteNumber(record.score)),
      owner.state,
      owner.value
    ]);
  }

  function deduplicateSessions(sessions) {
    const input = Array.isArray(sessions) ? sessions : [];
    const groups = new Map();
    for (const record of input) {
      if (!record || typeof record !== "object" || Array.isArray(record)) continue;
      const id = identifier(record.id);
      if (id === null) continue;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(record);
    }

    const records = [];
    const duplicateSessionIds = [];
    const conflictingSessionIds = [];
    for (const [id, group] of groups) {
      if (group.length === 1) {
        records.push(group[0]);
        continue;
      }
      const signatures = new Set(group.map(sessionSignature));
      if (signatures.size === 1) {
        duplicateSessionIds.push(id);
        records.push(group[0]);
      } else {
        conflictingSessionIds.push(id);
      }
    }
    return { records, inputCount: input.length, duplicateSessionIds, conflictingSessionIds };
  }

  function structuralSession(record, requestedKrok) {
    if (!record || typeof record !== "object" || Array.isArray(record)) return null;
    const id = identifier(record.id);
    const createdAt = parseTimestamp(record.created_at);
    const krok = integerValue(record.krok);
    const owner = ownership(record.user_id);
    if (
      id === null ||
      createdAt === null ||
      (krok !== 1 && krok !== 2) ||
      (requestedKrok !== null && krok !== requestedKrok) ||
      !isExamMode(record.mode) ||
      owner.state === "invalid"
    ) return null;
    return { id, createdAt, krok, owner, record };
  }

  function metricSession(record, krok) {
    const structural = structuralSession(record, krok);
    if (!structural) return null;
    const questions = nonnegativeInteger(record.questions_total);
    const correct = nonnegativeInteger(record.correct);
    if (questions === null || correct === null || correct > questions) return null;
    return { ...structural, questions, correct };
  }

  function selectSessions(sessions, options, validator) {
    const settings = options || {};
    const krok = requireKrok(settings.krok);
    const filter = settings.filter || TIME_FILTERS.ALL_TIME;
    const window = getTimeWindow(filter, settings.referenceTime);
    const deduplicated = deduplicateSessions(sessions);
    const selected = [];
    for (const record of deduplicated.records) {
      const session = validator(record, krok);
      if (session && timestampInWindow(session.createdAt, window)) selected.push(session);
    }
    return { ...deduplicated, selected, window };
  }

  function integritySummary(result) {
    return {
      duplicateSessionIds: result.duplicateSessionIds.slice(),
      conflictingSessionIds: result.conflictingSessionIds.slice()
    };
  }

  function filterSessionsByTime(sessions, filter, options) {
    const settings = options || {};
    const window = getTimeWindow(filter, settings.referenceTime);
    const krok = settings.krok === undefined ? null : requireKrok(settings.krok);
    const deduplicated = deduplicateSessions(sessions);
    return deduplicated.records.filter(record => {
      const session = structuralSession(record, krok);
      return session !== null && timestampInWindow(session.createdAt, window);
    });
  }

  function accuracy(correct, questions) {
    return questions > 0 ? (correct / questions) * 100 : null;
  }

  function calculateOverallPerformance(sessions, options) {
    const result = selectSessions(sessions, options, metricSession);
    const meaningful = result.selected.filter(session => session.questions > 0);
    let questionCount = 0;
    let correctCount = 0;
    for (const session of meaningful) {
      questionCount += session.questions;
      correctCount += session.correct;
    }
    return {
      sessionCount: meaningful.length,
      questionCount,
      correctCount,
      accuracy: accuracy(correctCount, questionCount),
      zeroQuestionSessionCount: result.selected.length - meaningful.length,
      excludedSessionCount: result.inputCount - meaningful.length,
      integrity: integritySummary(result),
      window: result.window
    };
  }

  function indexQuestionRecords(questionRecords) {
    const index = new Map();
    const input = Array.isArray(questionRecords) ? questionRecords : [];
    for (const record of input) {
      if (!record || typeof record !== "object" || Array.isArray(record)) continue;
      const sessionId = identifier(record.exam_session_id);
      if (sessionId === null) continue;
      if (!index.has(sessionId)) index.set(sessionId, []);
      index.get(sessionId).push(record);
    }
    return index;
  }

  function inspectQuestionRecord(record, session) {
    const issues = [];
    const questionId = identifier(record.question_id);
    const subject = normalizeSubject(record.subject);
    const detailOwner = ownership(record.user_id);
    if (questionId === null) issues.push("invalid_question_id");
    if (subject === null) issues.push("invalid_subject");
    if (subject !== null && isMetadataSubject(subject)) issues.push("metadata_subject");
    if (typeof record.is_correct !== "boolean") issues.push("invalid_correctness");
    if (detailOwner.state === "invalid") issues.push("invalid_owner");
    if (
      session.owner.state === "present" &&
      detailOwner.state === "present" &&
      session.owner.value !== detailOwner.value
    ) issues.push("ownership_mismatch");

    const sessionSubject = normalizeSubject(session.record.subject);
    if (
      subject !== null &&
      sessionSubject !== null &&
      !isMetadataSubject(sessionSubject) &&
      subject !== sessionSubject
    ) issues.push("subject_mismatch");
    return { record, questionId, subject, issues, valid: issues.length === 0 };
  }

  function classifyCoverageForSession(session, candidateRows) {
    const expected = nonnegativeInteger(session.record.questions_total);
    const correct = nonnegativeInteger(session.record.correct);
    const rows = Array.isArray(candidateRows) ? candidateRows : [];
    const inspected = rows.map(row => inspectQuestionRecord(row, session));
    const issueSet = new Set(inspected.flatMap(item => item.issues));
    const validRows = inspected.filter(item => item.valid);
    const metadataSubjectRecordCount = inspected.filter(
      item => item.subject !== null && isMetadataSubject(item.subject)
    ).length;
    const usableSubjectRecordCount = inspected.filter(
      item => item.subject !== null && !isMetadataSubject(item.subject)
    ).length;
    let subjectAttributionStatus = "available";
    if (rows.length === 0) {
      subjectAttributionStatus = "missing";
    } else if (usableSubjectRecordCount === 0 && metadataSubjectRecordCount > 0) {
      subjectAttributionStatus = "unavailable";
      issueSet.add("missing_usable_subject_attribution");
    } else if (
      metadataSubjectRecordCount > 0 ||
      issueSet.has("invalid_subject") ||
      issueSet.has("subject_mismatch")
    ) {
      subjectAttributionStatus = "inconsistent";
    }
    const seenIds = new Set();
    let duplicateCount = 0;
    for (const item of inspected) {
      if (item.questionId === null) continue;
      if (seenIds.has(item.questionId)) duplicateCount += 1;
      seenIds.add(item.questionId);
    }
    if (duplicateCount > 0) issueSet.add("duplicate_question_id");

    const trueCount = validRows.reduce(
      (sum, item) => sum + (item.record.is_correct === true ? 1 : 0),
      0
    );
    let status;
    if (expected === null) {
      status = "unknown";
      issueSet.add("invalid_expected_count");
    } else if (correct === null || correct > expected) {
      status = "inconsistent";
      issueSet.add("invalid_session_correct_count");
    } else if (expected === 0 && rows.length === 0) {
      status = "not_applicable";
    } else if (expected === 0) {
      status = "inconsistent";
      issueSet.add("details_for_zero_question_session");
    } else if (rows.length === 0) {
      status = "missing";
    } else if (validRows.length === expected && seenIds.size === expected && duplicateCount === 0) {
      if (trueCount === correct) {
        status = "complete";
      } else {
        status = "inconsistent";
        issueSet.add("correct_count_mismatch");
      }
    } else {
      const contradictory = [
        "metadata_subject",
        "ownership_mismatch",
        "subject_mismatch",
        "duplicate_question_id"
      ].some(issue => issueSet.has(issue));
      status = contradictory ? "inconsistent" : "partial";
    }

    return {
      sessionId: session.id,
      status,
      expectedQuestionCount: expected,
      sessionCorrectCount: correct,
      detailCorrectCount: validRows.length > 0 ? trueCount : null,
      detailRecordCount: validRows.length,
      rawDetailRecordCount: rows.length,
      uniqueQuestionCount: seenIds.size,
      duplicateQuestionCount: duplicateCount,
      invalidDetailRecordCount: rows.length - validRows.length,
      usableSubjectRecordCount,
      metadataSubjectRecordCount,
      subjectAttributionStatus,
      issues: Array.from(issueSet).sort(),
      zeroQuestionSession: expected === 0,
      eligibleForSessionAnalytics: expected !== null && expected > 0 && correct !== null && correct <= expected,
      eligibleForQuestionAnalytics: status === "complete",
      records: status === "complete" ? validRows.map(item => item.record) : []
    };
  }

  function emptyCoverageCounts() {
    return Object.fromEntries(COVERAGE_STATUSES.map(status => [status, 0]));
  }

  function coverageTransparency(classified) {
    return {
      sessionLevel: {
        selectedSessionCount: classified.length,
        meaningfulPerformanceSessionCount: classified.filter(item => item.eligibleForSessionAnalytics).length,
        zeroQuestionSessionCount: classified.filter(item => item.zeroQuestionSession).length
      },
      questionLevel: {
        analyzedSessionCount: classified.filter(item => item.eligibleForQuestionAnalytics).length,
        missingDetailSessionCount: classified.filter(item => item.status === "missing").length,
        unattributedSessionCount: classified.filter(
          item => item.subjectAttributionStatus === "unavailable"
        ).length,
        excludedDetailSessionCount: classified.filter(item => !item.eligibleForQuestionAnalytics).length
      }
    };
  }

  function classifyHistoricalCoverage(sessions, questionRecords, options) {
    const result = selectSessions(sessions, options, structuralSession);
    const questionIndex = indexQuestionRecords(questionRecords);
    const classified = result.selected.map(session =>
      classifyCoverageForSession(session, questionIndex.get(session.id))
    );
    const counts = emptyCoverageCounts();
    for (const item of classified) counts[item.status] += 1;
    return {
      counts,
      ...coverageTransparency(classified),
      sessions: classified,
      excludedSessionCount: result.inputCount - result.selected.length,
      integrity: integritySummary(result),
      window: result.window
    };
  }

  function calculateSubjectPerformance(sessions, questionRecords, options) {
    const result = selectSessions(sessions, options, structuralSession);
    const questionIndex = indexQuestionRecords(questionRecords);
    const subjectMap = new Map();
    const coverageCounts = emptyCoverageCounts();
    const classified = [];
    for (const session of result.selected) {
      const coverage = classifyCoverageForSession(session, questionIndex.get(session.id));
      classified.push(coverage);
      coverageCounts[coverage.status] += 1;
      if (!coverage.eligibleForQuestionAnalytics) continue;
      for (const row of coverage.records) {
        const subject = normalizeSubject(row.subject);
        if (!subjectMap.has(subject)) {
          subjectMap.set(subject, {
            subject,
            questionCount: 0,
            correctCount: 0,
            sessionIds: new Set()
          });
        }
        const aggregate = subjectMap.get(subject);
        aggregate.questionCount += 1;
        if (row.is_correct === true) aggregate.correctCount += 1;
        aggregate.sessionIds.add(session.id);
      }
    }

    const subjects = Array.from(subjectMap.values(), item => ({
      subject: item.subject,
      questionCount: item.questionCount,
      correctCount: item.correctCount,
      sessionCount: item.sessionIds.size,
      accuracy: accuracy(item.correctCount, item.questionCount)
    })).sort((left, right) => left.subject.localeCompare(right.subject, "en"));
    return {
      subjects,
      coverage: coverageCounts,
      ...coverageTransparency(classified),
      integrity: integritySummary(result),
      window: result.window
    };
  }

  function compareIdentifiers(left, right) {
    return String(left).localeCompare(String(right), "en", { numeric: true });
  }

  function calculateSubjectTrends(sessions, questionRecords, options) {
    const settings = options || {};
    const minimumQuestionsPerHalf = requirePositiveInteger(
      settings.minimumQuestionsPerHalf === undefined
        ? DEFAULT_SUBJECT_TREND_OPTIONS.minimumQuestionsPerHalf
        : settings.minimumQuestionsPerHalf,
      "minimumQuestionsPerHalf"
    );
    const changeThresholdPercentagePoints = requireNonnegativeNumber(
      settings.changeThresholdPercentagePoints === undefined
        ? DEFAULT_SUBJECT_TREND_OPTIONS.changeThresholdPercentagePoints
        : settings.changeThresholdPercentagePoints,
      "changeThresholdPercentagePoints"
    );
    const result = selectSessions(sessions, settings, structuralSession);
    const questionIndex = indexQuestionRecords(questionRecords);
    const subjectRecords = new Map();

    for (const session of result.selected) {
      const coverage = classifyCoverageForSession(session, questionIndex.get(session.id));
      if (!coverage.eligibleForQuestionAnalytics) continue;
      for (const row of coverage.records) {
        const subject = normalizeSubject(row.subject);
        if (!subjectRecords.has(subject)) subjectRecords.set(subject, []);
        subjectRecords.get(subject).push({
          sessionId: session.id,
          timestamp: session.createdAt,
          questionId: identifier(row.question_id),
          recordId: identifier(row.id) || "",
          isCorrect: row.is_correct
        });
      }
    }

    const subjects = Array.from(subjectRecords, ([subject, records]) => {
      records.sort((left, right) =>
        left.timestamp - right.timestamp ||
        compareIdentifiers(left.sessionId, right.sessionId) ||
        compareIdentifiers(left.questionId, right.questionId) ||
        compareIdentifiers(left.recordId, right.recordId)
      );
      const splitIndex = Math.floor(records.length / 2);
      const olderRecords = records.slice(0, splitIndex);
      const newerRecords = records.slice(splitIndex);
      const summarize = half => {
        const correctCount = half.reduce(
          (sum, record) => sum + (record.isCorrect === true ? 1 : 0),
          0
        );
        return {
          questionCount: half.length,
          correctCount,
          accuracy: accuracy(correctCount, half.length)
        };
      };
      const older = summarize(olderRecords);
      const newer = summarize(newerRecords);
      const hasEnoughData =
        older.questionCount >= minimumQuestionsPerHalf &&
        newer.questionCount >= minimumQuestionsPerHalf;
      const differencePercentagePoints = hasEnoughData
        ? normalizedDifference(newer.accuracy - older.accuracy)
        : null;
      let status = "insufficient_data";
      if (hasEnoughData) {
        if (differencePercentagePoints >= changeThresholdPercentagePoints) {
          status = "improving";
        } else if (differencePercentagePoints <= -changeThresholdPercentagePoints) {
          status = "declining";
        } else {
          status = "stable";
        }
      }
      return {
        subject,
        status,
        older,
        newer,
        differencePercentagePoints,
        eligibleQuestionCount: records.length
      };
    }).sort((left, right) => left.subject.localeCompare(right.subject, "en"));

    return {
      subjects,
      thresholds: { minimumQuestionsPerHalf, changeThresholdPercentagePoints },
      integrity: integritySummary(result),
      window: result.window,
      note: "Trends are descriptive product heuristics, not statistically validated predictions."
    };
  }

  function requirePositiveInteger(value, name) {
    const number = integerValue(value);
    if (number === null || number <= 0) throw new TypeError(`${name} must be a positive integer`);
    return number;
  }

  function requireNonnegativeNumber(value, name) {
    let number = null;
    if (typeof value === "number") number = value;
    if (typeof value === "string" && value.trim() !== "" && /^\d+(?:\.\d+)?$/.test(value.trim())) {
      number = Number(value.trim());
    }
    if (!Number.isFinite(number) || number < 0) {
      throw new TypeError(`${name} must be a non-negative number`);
    }
    return number;
  }

  function summarizeWindow(sessions, start, end) {
    let sessionCount = 0;
    let questionCount = 0;
    let correctCount = 0;
    for (const session of sessions) {
      if (session.questions === 0 || session.createdAt < start || session.createdAt >= end) continue;
      sessionCount += 1;
      questionCount += session.questions;
      correctCount += session.correct;
    }
    return {
      start,
      end,
      sessionCount,
      questionCount,
      correctCount,
      accuracy: accuracy(correctCount, questionCount)
    };
  }

  function normalizedDifference(value) {
    return Number(value.toFixed(12));
  }

  function compareRecentToPrevious(sessions, options) {
    const settings = options || {};
    const krok = requireKrok(settings.krok);
    const referenceTime = requireReferenceTime(settings.referenceTime);
    const days = requirePositiveInteger(
      settings.days === undefined ? DEFAULT_COMPARISON_OPTIONS.days : settings.days,
      "days"
    );
    const minimumQuestions = requirePositiveInteger(
      settings.minimumQuestions === undefined
        ? DEFAULT_COMPARISON_OPTIONS.minimumQuestions
        : settings.minimumQuestions,
      "minimumQuestions"
    );
    const stableThresholdPercentagePoints = requireNonnegativeNumber(
      settings.stableThresholdPercentagePoints === undefined
        ? DEFAULT_COMPARISON_OPTIONS.stableThresholdPercentagePoints
        : settings.stableThresholdPercentagePoints,
      "stableThresholdPercentagePoints"
    );
    const deduplicated = deduplicateSessions(sessions);
    const validSessions = deduplicated.records
      .map(record => metricSession(record, krok))
      .filter(Boolean);
    const duration = days * DAY_MS;
    const recent = summarizeWindow(validSessions, referenceTime - duration, referenceTime);
    const previous = summarizeWindow(
      validSessions,
      referenceTime - duration * 2,
      referenceTime - duration
    );
    const hasEnoughData =
      recent.questionCount >= minimumQuestions &&
      previous.questionCount >= minimumQuestions;
    const differencePercentagePoints = hasEnoughData
      ? normalizedDifference(recent.accuracy - previous.accuracy)
      : null;
    let status = "insufficient_data";
    if (hasEnoughData) {
      if (
        Math.abs(differencePercentagePoints) <=
        stableThresholdPercentagePoints + COMPARISON_EPSILON
      ) status = "stable";
      else if (differencePercentagePoints > 0) status = "improving";
      else status = "declining";
    }
    return {
      status,
      recent,
      previous,
      differencePercentagePoints,
      thresholds: { minimumQuestions, stableThresholdPercentagePoints },
      integrity: integritySummary(deduplicated),
      note: "Direction describes the observed difference only; it does not establish statistical significance."
    };
  }

  function generateLearningTrend(sessions, options) {
    const result = selectSessions(sessions, options, metricSession);
    const buckets = new Map();
    for (const session of result.selected) {
      if (session.questions === 0) continue;
      const day = new Date(session.createdAt).toISOString().slice(0, 10);
      if (!buckets.has(day)) {
        buckets.set(day, { period: day, sessionCount: 0, correctCount: 0, questionCount: 0 });
      }
      const bucket = buckets.get(day);
      bucket.sessionCount += 1;
      bucket.correctCount += session.correct;
      bucket.questionCount += session.questions;
    }
    const points = Array.from(buckets.values())
      .sort((left, right) => left.period.localeCompare(right.period))
      .map(point => ({ ...point, accuracy: accuracy(point.correctCount, point.questionCount) }));
    return {
      grouping: "utc_day_with_data",
      points,
      zeroQuestionSessionCount: result.selected.filter(session => session.questions === 0).length,
      integrity: integritySummary(result),
      window: result.window
    };
  }

  function buildAnalytics(sessions, questionRecords, options) {
    return {
      overall: calculateOverallPerformance(sessions, options),
      subjects: calculateSubjectPerformance(sessions, questionRecords, options),
      subjectTrends: calculateSubjectTrends(sessions, questionRecords, options),
      coverage: classifyHistoricalCoverage(sessions, questionRecords, options),
      trend: generateLearningTrend(sessions, options)
    };
  }

  return Object.freeze({
    TIME_FILTERS,
    SUBJECT_ALIASES,
    DEFAULT_COMPARISON_OPTIONS,
    DEFAULT_SUBJECT_TREND_OPTIONS,
    parseTimestamp,
    normalizeSubject,
    getTimeWindow,
    filterSessionsByTime,
    calculateOverallPerformance,
    classifyHistoricalCoverage,
    calculateSubjectPerformance,
    calculateSubjectTrends,
    compareRecentToPrevious,
    generateLearningTrend,
    buildAnalytics
  });
});
