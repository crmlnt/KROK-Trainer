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
    if (!engine?.TIME_FILTERS || typeof integration?.adaptAnalyticsToLegacyView !== "function") {
      throw new TypeError("Statistics analytics dependencies are required");
    }
    if (!Number.isFinite(referenceTime)) {
      throw new TypeError("A fixed numeric reference timestamp is required");
    }

    const validFilters = new Set(Object.values(engine.TIME_FILTERS));
    const views = new Map();

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

    return Object.freeze({
      getView,
      referenceTime,
      get cachedViewCount() { return views.size; }
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

  return Object.freeze({ createPeriodViewStore, updateChartInstance });
});
