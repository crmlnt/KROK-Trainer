/**
 * Small state helpers for the Statistics page.
 *
 * Period views are derived from one validated in-memory dataset and one fixed
 * reference timestamp. Chart updates retain a single Chart.js instance.
 */
(function attachStatisticsPageController(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StatisticsPageController = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createControllerApi() {
  "use strict";

  function createPeriodViewStore({ data, engine, integration, referenceTime }) {
    if (!data || !Array.isArray(data.sessions) || !Array.isArray(data.questionRecords)) {
      throw new TypeError("A complete Statistics dataset is required");
    }
    if (
      !engine?.TIME_FILTERS ||
      typeof engine.normalizeSubject !== "function" ||
      typeof integration?.adaptAnalyticsToLegacyView !== "function" ||
      typeof integration?.adaptSubjectDetailView !== "function"
    ) {
      throw new TypeError("Statistics analytics dependencies are required");
    }
    if (!Number.isFinite(referenceTime)) {
      throw new TypeError("A fixed numeric reference timestamp is required");
    }

    const validFilters = new Set(Object.values(engine.TIME_FILTERS));
    const views = new Map();
    const subjectViews = new Map();

    function getView(filter) {
      if (!validFilters.has(filter)) throw new TypeError(`Unknown time filter: ${String(filter)}`);
      if (!views.has(filter)) {
        views.set(filter, integration.adaptAnalyticsToLegacyView(
          data.sessions,
          data.questionRecords,
          engine,
          { filter, referenceTime }
        ));
      }
      return views.get(filter);
    }

    function getSubjectView(filter, subject, krok) {
      if (!validFilters.has(filter)) throw new TypeError(`Unknown time filter: ${String(filter)}`);
      const normalizedSubject = engine.normalizeSubject(subject);
      if (normalizedSubject === null) throw new TypeError("A normalized subject is required");
      if (krok !== 1 && krok !== 2) throw new TypeError("krok must be either 1 or 2");
      const key = JSON.stringify([filter, normalizedSubject, krok]);
      if (!subjectViews.has(key)) {
        subjectViews.set(key, integration.adaptSubjectDetailView(
          data.sessions,
          data.questionRecords,
          engine,
          { filter, subject: normalizedSubject, krok, referenceTime }
        ));
      }
      return subjectViews.get(key);
    }

    return Object.freeze({
      getView,
      getSubjectView,
      referenceTime,
      get cachedViewCount() { return views.size; },
      get cachedSubjectViewCount() { return subjectViews.size; }
    });
  }

  function createViewNavigator({ engine, initialFilter }) {
    if (!engine?.TIME_FILTERS || typeof engine.normalizeSubject !== "function") {
      throw new TypeError("Statistics analytics dependencies are required");
    }
    const validFilters = new Set(Object.values(engine.TIME_FILTERS));
    if (!validFilters.has(initialFilter)) {
      throw new TypeError(`Unknown time filter: ${String(initialFilter)}`);
    }
    let state = { mode: "dashboard", filter: initialFilter, subject: null, krok: null };
    const snapshot = () => Object.freeze({ ...state });

    function selectFilter(filter) {
      if (!validFilters.has(filter)) throw new TypeError(`Unknown time filter: ${String(filter)}`);
      state = { ...state, filter };
      return snapshot();
    }

    function openSubject(subject, krok) {
      const normalizedSubject = engine.normalizeSubject(subject);
      if (normalizedSubject === null) throw new TypeError("A normalized subject is required");
      if (krok !== 1 && krok !== 2) throw new TypeError("krok must be either 1 or 2");
      state = { ...state, mode: "subject", subject: normalizedSubject, krok };
      return snapshot();
    }

    function showDashboard() {
      state = { ...state, mode: "dashboard", subject: null, krok: null };
      return snapshot();
    }

    return Object.freeze({
      selectFilter,
      openSubject,
      showDashboard,
      getState: snapshot
    });
  }

  function updateChartInstance(currentChart, ChartConstructor, canvas, config) {
    if (currentChart) {
      currentChart.data = config.data;
      currentChart.options = config.options;
      currentChart.update();
      return currentChart;
    }
    if (typeof ChartConstructor !== "function") {
      throw new TypeError("A Chart constructor is required");
    }
    return new ChartConstructor(canvas, config);
  }

  return Object.freeze({ createPeriodViewStore, createViewNavigator, updateChartInstance });
});
