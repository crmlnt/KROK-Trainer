// =========================
// STATISTICS
// =========================
const loadingSection = document.getElementById("statisticsLoading");
const loginRequired = document.getElementById("loginRequired");
const emptyStatistics = document.getElementById("emptyStatistics");
const statisticsContent = document.getElementById("statisticsContent");
const totalExamsEl = document.getElementById("totalExams");
const totalQuestionsEl = document.getElementById("totalQuestions");
const overallAccuracyEl = document.getElementById("overallAccuracy");
const bestScoreEl = document.getElementById("bestScore");
const krok1AccuracyEl = document.getElementById("krok1Accuracy");
const krok1ExamsEl = document.getElementById("krok1Exams");
const krok2AccuracyEl = document.getElementById("krok2Accuracy");
const krok2ExamsEl = document.getElementById("krok2Exams");
const subjectStatsEl = document.getElementById("subjectStats");
const weakSubjectsEl = document.getElementById("weakSubjects");
const progressCanvas = document.getElementById("progressCanvas");
const progressEmptyEl = document.getElementById("progressEmpty");
const temporalFilterButtons = Array.from(document.querySelectorAll("[data-time-filter]"));

const WEAK_SUBJECT_MIN_QUESTIONS = StatisticsIntegration.WEAK_SUBJECT_MIN_QUESTIONS;
const KROK_PASS_THRESHOLD = StatisticsIntegration.KROK_PASS_THRESHOLD;
const WEAK_SUBJECT_PREVIEW_COUNT = 2;
const DEFAULT_TIME_FILTER = KrokAnalytics.TIME_FILTERS.ALL_TIME;
const TIME_FILTER_LABELS = Object.freeze({
  [KrokAnalytics.TIME_FILTERS.ALL_TIME]: "All Time",
  [KrokAnalytics.TIME_FILTERS.LAST_90_DAYS]: "Last 90 Days",
  [KrokAnalytics.TIME_FILTERS.LAST_30_DAYS]: "Last 30 Days",
  [KrokAnalytics.TIME_FILTERS.LAST_7_DAYS]: "Last 7 Days"
});
let weakSubjectsExpanded = false;
let selectedTimeFilter = DEFAULT_TIME_FILTER;
let periodViewStore = null;
let progressChartInstance = null;

function getWeakSubjectStatus(stat) {
  return StatisticsIntegration.getWeakSubjectStatus(stat);
}

function displayPercentage(value, emptyValue = "—") {
  return StatisticsIntegration.formatPercentage(value, emptyValue);
}

function percentagePointText(value, signed = false) {
  const absolute = displayPercentage(Math.abs(value)).replace("%", "");
  const sign = signed ? (value > 0 ? "+" : value < 0 ? "−" : "") : "";
  return `${sign}${absolute} percentage points`;
}

function passThresholdDistance(accuracy) {
  return StatisticsIntegration.formatThresholdDistance(accuracy, KROK_PASS_THRESHOLD);
}

function trendMarkup(trend, filter) {
  const data = trend || { status: "insufficient_data" };
  const content = {
    improving: { label: "Improving", icon: "↗" },
    stable: { label: "Stable", icon: "→" },
    declining: { label: "Declining", icon: "↘" },
    insufficient_data: { label: "Not enough data", icon: "—" }
  }[data.status] || { label: "Not enough data", icon: "—" };
  const scope = data.krok ? ` in KROK ${data.krok}` : "";
  const periodScope = filter === KrokAnalytics.TIME_FILTERS.ALL_TIME
    ? "across all eligible history"
    : `within ${TIME_FILTER_LABELS[filter]}`;
  if (data.status === "insufficient_data") {
    const explanation = data.reason === "separate_krok_histories"
      ? `KROK 1 and KROK 2 trend histories are kept separate ${periodScope}.`
      : `Requires 20 earlier and 20 recent eligible responses${scope} ${periodScope}.`;
    return `<div class="weak-subject-trend trend-insufficient"><span class="trend-icon" aria-hidden="true">${content.icon}</span><strong>${content.label}</strong><span>${explanation}</span></div>`;
  }
  return `<div class="weak-subject-trend trend-${data.status}"><span class="trend-icon" aria-hidden="true">${content.icon}</span><strong>${content.label}</strong><span class="trend-delta">${percentagePointText(data.differencePercentagePoints, true)}</span><span>Recent versus earlier eligible responses${scope} ${periodScope}.</span></div>`;
}

function renderWeakSubjects(subjectStats, filter, emptyMessage) {
  if (!weakSubjectsEl) return;
  weakSubjectsEl.innerHTML = "";

  if (!subjectStats.length) {
    weakSubjectsEl.innerHTML = `<div class="weak-subjects-empty">${emptyMessage}</div>`;
    return;
  }

  const ranked = [...subjectStats].sort((a, b) => {
    const aEligible = a.questions >= WEAK_SUBJECT_MIN_QUESTIONS;
    const bEligible = b.questions >= WEAK_SUBJECT_MIN_QUESTIONS;
    if (aEligible !== bEligible) return aEligible ? -1 : 1;
    if (aEligible && bEligible && a.accuracy !== b.accuracy) return a.accuracy - b.accuracy;
    return b.questions - a.questions;
  });

  const visibleSubjects = weakSubjectsExpanded
    ? ranked
    : ranked.slice(0, WEAK_SUBJECT_PREVIEW_COUNT);

  visibleSubjects.forEach(stat => {
    const status = getWeakSubjectStatus(stat);
    const remaining = Math.max(0, WEAK_SUBJECT_MIN_QUESTIONS - stat.questions);
    const card = document.createElement("article");
    card.className = `weak-subject-card status-${status}`;

    let badge = "Not enough data";
    let detail = `${remaining} more question${remaining === 1 ? "" : "s"} needed · ${passThresholdDistance(stat.accuracy)}`;

    if (status === "weak") {
      badge = "Weak";
      detail = passThresholdDistance(stat.accuracy);
    } else if (status === "risk") {
      badge = "At risk";
      detail = passThresholdDistance(stat.accuracy);
    } else if (status === "strong") {
      badge = "On track";
      detail = passThresholdDistance(stat.accuracy);
    }

    card.innerHTML = `
      <div class="weak-subject-main">
        <div class="weak-subject-title-row">
          <h3>${stat.subject}</h3>
          <span class="weak-subject-badge">${badge}</span>
        </div>
        <div class="weak-subject-meta">${stat.questions} questions · ${stat.correct} correct · ${stat.exams} ${stat.exams === 1 ? "exam" : "exams"}</div>
        <div class="weak-subject-detail">${detail}</div>
        ${trendMarkup(stat.trend, filter)}
      </div>
      <div class="weak-subject-score">${displayPercentage(stat.accuracy)}</div>`;

    weakSubjectsEl.appendChild(card);
  });

  if (ranked.length > WEAK_SUBJECT_PREVIEW_COUNT) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "weak-subjects-toggle";
    toggle.setAttribute("aria-expanded", String(weakSubjectsExpanded));
    toggle.innerHTML = `
      <span>${weakSubjectsExpanded ? "Show less" : `Show all subjects (${ranked.length})`}</span>
      <svg class="weak-subjects-chevron${weakSubjectsExpanded ? " expanded" : ""}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m6 9 6 6 6-6"></path>
      </svg>`;
    toggle.addEventListener("click", () => {
      weakSubjectsExpanded = !weakSubjectsExpanded;
      renderWeakSubjects(subjectStats, filter, emptyMessage);
    });
    weakSubjectsEl.appendChild(toggle);
  }
}

function setTemporalSelectorState(filter) {
  temporalFilterButtons.forEach(button => {
    button.setAttribute("aria-pressed", String(button.dataset.timeFilter === filter));
  });
}

function progressChartConfig(labels, scores) {
  return {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Exam Score",
        data: scores,
        borderColor: "#16a34a",
        backgroundColor: "rgba(22, 163, 74, 0.08)",
        borderWidth: 3,
        pointRadius: 5,
        pointHoverRadius: 7,
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: context => `Score: ${displayPercentage(context.raw)}` } }
      },
      scales: {
        y: { min: 0, max: 100, ticks: { callback: value => `${value}%` } },
        x: { grid: { display: false } }
      }
    }
  };
}

function renderStatisticsView(view) {
  const periodLabel = TIME_FILTER_LABELS[view.filter];
  const hasExams = view.totalExams > 0;
  const subjectEmptyMessage = hasExams
    ? `No eligible question-level subject data is available for ${periodLabel}. Overall exam metrics remain available.`
    : `No Exam Mode sessions are available for ${periodLabel}.`;

  setTemporalSelectorState(view.filter);
  window.KrokStatisticsCoverage = {
    ...view.coverage,
    filter: view.filter,
    window: view.window
  };

  totalExamsEl.textContent = view.totalExams;
  totalQuestionsEl.textContent = view.totalQuestions.toLocaleString();
  overallAccuracyEl.textContent = displayPercentage(view.overallAccuracy);
  bestScoreEl.textContent = displayPercentage(view.bestScore);
  krok1AccuracyEl.textContent = displayPercentage(view.krok1.accuracy);
  krok1ExamsEl.textContent = `${view.krok1.exams} ${view.krok1.exams === 1 ? "exam" : "exams"}`;
  krok2AccuracyEl.textContent = displayPercentage(view.krok2.accuracy);
  krok2ExamsEl.textContent = `${view.krok2.exams} ${view.krok2.exams === 1 ? "exam" : "exams"}`;

  subjectStatsEl.innerHTML = "";
  if (!view.subjectStats.length) {
    subjectStatsEl.innerHTML = `<p class="subject-stats-empty">${subjectEmptyMessage}</p>`;
  } else {
    view.subjectStats.forEach(stat => {
      const row = document.createElement("div");
      row.className = "subject-stat-row";
      row.innerHTML = `<div class="subject-stat-name">${stat.subject}<small>${stat.questions} questions · ${stat.exams} ${stat.exams === 1 ? "exam" : "exams"}</small></div><div class="subject-stat-track"><div class="subject-stat-fill" style="width:${stat.accuracy}%"></div></div><div class="subject-stat-value">${displayPercentage(stat.accuracy)}</div>`;
      subjectStatsEl.appendChild(row);
    });
  }

  renderWeakSubjects(view.subjectStats, view.filter, subjectEmptyMessage);

  const progressLabels = view.progress.map(item =>
    new Date(item.createdAtTimestamp).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    })
  );
  const progressScores = view.progress.map(item => item.accuracy);
  const hasProgress = progressScores.length > 0;
  progressCanvas.hidden = !hasProgress;
  progressEmptyEl.hidden = hasProgress;
  progressEmptyEl.textContent = hasProgress ? "" : `No Exam Mode sessions are available for ${periodLabel}.`;
  progressChartInstance = StatisticsPageController.updateChartInstance(
    progressChartInstance,
    Chart,
    progressCanvas,
    progressChartConfig(progressLabels, progressScores)
  );
}

function selectTimeFilter(filter) {
  if (!periodViewStore) return;
  selectedTimeFilter = filter;
  weakSubjectsExpanded = false;
  renderStatisticsView(periodViewStore.getView(filter));
}

temporalFilterButtons.forEach(button => {
  button.addEventListener("click", () => selectTimeFilter(button.dataset.timeFilter));
});

async function loadStatistics() {
  try {
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError) throw userError;
    if (!user) {
      loadingSection.hidden = true;
      loginRequired.hidden = false;
      return;
    }

    const data = await StatisticsIntegration.loadStatisticsData(supabaseClient, user.id);
    if (data.sessions.length === 0) {
      loadingSection.hidden = true;
      emptyStatistics.hidden = false;
      return;
    }
    const referenceTime = Date.now();
    periodViewStore = StatisticsPageController.createPeriodViewStore({
      data,
      engine: KrokAnalytics,
      integration: StatisticsIntegration,
      referenceTime
    });
    const allTimeView = periodViewStore.getView(DEFAULT_TIME_FILTER);
    if (allTimeView.totalExams === 0) {
      loadingSection.hidden = true;
      emptyStatistics.hidden = false;
      return;
    }

    selectedTimeFilter = DEFAULT_TIME_FILTER;
    renderStatisticsView(allTimeView);

    loadingSection.hidden = true;
    statisticsContent.hidden = false;
  } catch (error) {
    console.error("Error loading complete statistics:", error);
    loadingSection.hidden = false;
    loadingSection.innerHTML = "<p>Unable to load complete statistics. Please try again.</p>";
    statisticsContent.hidden = true;
    emptyStatistics.hidden = true;
  }
}
loadStatistics();
