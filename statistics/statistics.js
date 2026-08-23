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

const WEAK_SUBJECT_MIN_QUESTIONS = 10;
const KROK_PASS_THRESHOLD = 64;
const WEAK_SUBJECT_PREVIEW_COUNT = 2;
let weakSubjectsExpanded = false;

function getWeakSubjectStatus(stat) {
  if (stat.questions < WEAK_SUBJECT_MIN_QUESTIONS) return "insufficient";
  if (stat.accuracy < 50) return "weak";
  if (stat.accuracy < KROK_PASS_THRESHOLD) return "risk";
  return "strong";
}

function renderWeakSubjects(subjectStats) {
  if (!weakSubjectsEl) return;
  weakSubjectsEl.innerHTML = "";

  if (!subjectStats.length) {
    weakSubjectsEl.innerHTML = '<div class="weak-subjects-empty">Complete Exam Mode sessions to start identifying your focus areas.</div>';
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
    let detail = `${remaining} more question${remaining === 1 ? "" : "s"} needed`;

    if (status === "weak") {
      badge = "Weak";
      detail = "Priority review recommended";
    } else if (status === "risk") {
      badge = "At risk";
      detail = `Below the ${KROK_PASS_THRESHOLD}% pass threshold`;
    } else if (status === "strong") {
      badge = "On track";
      detail = `At or above the ${KROK_PASS_THRESHOLD}% pass threshold`;
    }

    card.innerHTML = `
      <div class="weak-subject-main">
        <div class="weak-subject-title-row">
          <h3>${stat.subject}</h3>
          <span class="weak-subject-badge">${badge}</span>
        </div>
        <div class="weak-subject-meta">${stat.questions} questions · ${stat.correct} correct · ${stat.exams} ${stat.exams === 1 ? "exam" : "exams"}</div>
        <div class="weak-subject-track" aria-hidden="true"><div class="weak-subject-fill" style="width:${Math.min(stat.accuracy, 100)}%"></div></div>
        <div class="weak-subject-detail">${detail}</div>
      </div>
      <div class="weak-subject-score">${stat.accuracy}%</div>`;

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
      renderWeakSubjects(subjectStats);
    });
    weakSubjectsEl.appendChild(toggle);
  }
}

async function loadStatistics() {
  const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
  if (userError || !user) { loadingSection.hidden = true; loginRequired.hidden = false; return; }

  const { data: sessions, error } = await supabaseClient.from("exam_sessions").select("*").eq("user_id", user.id).order("created_at", { ascending: true });
  if (error) { console.error("Error loading statistics:", error); loadingSection.innerHTML = "<p>Unable to load statistics.</p>"; return; }
  if (!sessions || sessions.length === 0) { loadingSection.hidden = true; emptyStatistics.hidden = false; return; }

  const { data: questionRows, error: questionError } = await supabaseClient
    .from("exam_session_questions")
    .select("exam_session_id, subject, is_correct")
    .eq("user_id", user.id);

  if (questionError) console.error("Error loading question-level statistics:", questionError);

  const totalExams = sessions.length;
  const totalQuestions = sessions.reduce((sum, session) => sum + Number(session.questions_total || 0), 0);
  const totalCorrect = sessions.reduce((sum, session) => sum + Number(session.correct || 0), 0);
  const overallAccuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
  const bestScore = Math.max(...sessions.map(session => Number(session.score || 0)));

  function calculateKrokStats(krokNumber) {
    const krokSessions = sessions.filter(session => Number(session.krok) === krokNumber);
    if (!krokSessions.length) return { exams: 0, accuracy: null };
    const questions = krokSessions.reduce((sum, session) => sum + Number(session.questions_total || 0), 0);
    const correct = krokSessions.reduce((sum, session) => sum + Number(session.correct || 0), 0);
    return { exams: krokSessions.length, accuracy: questions ? Math.round((correct / questions) * 100) : 0 };
  }

  const krok1Stats = calculateKrokStats(1);
  const krok2Stats = calculateKrokStats(2);

  const subjectMap = {};
  if (!questionError && questionRows?.length) {
    questionRows.forEach(row => {
      const subject = row.subject || "Unknown";
      if (!subjectMap[subject]) subjectMap[subject] = { questions: 0, correct: 0, sessionIds: new Set() };
      subjectMap[subject].questions += 1;
      if (row.is_correct) subjectMap[subject].correct += 1;
      subjectMap[subject].sessionIds.add(String(row.exam_session_id));
    });
  } else {
    sessions.forEach(session => {
      const subject = session.subject || "Unknown";
      if (subject === "All Topics") return;
      if (!subjectMap[subject]) subjectMap[subject] = { questions: 0, correct: 0, sessionIds: new Set() };
      subjectMap[subject].questions += Number(session.questions_total || 0);
      subjectMap[subject].correct += Number(session.correct || 0);
      subjectMap[subject].sessionIds.add(String(session.id));
    });
  }

  const subjectStats = Object.entries(subjectMap).map(([subject, data]) => ({
    subject,
    questions: data.questions,
    correct: data.correct,
    exams: data.sessionIds.size,
    accuracy: data.questions ? Math.round((data.correct / data.questions) * 100) : 0
  })).sort((a, b) => b.accuracy - a.accuracy || b.questions - a.questions);

  const progressLabels = sessions.map(session => new Date(session.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }));
  const progressScores = sessions.map(session => Number(session.score || 0));

  totalExamsEl.textContent = totalExams;
  totalQuestionsEl.textContent = totalQuestions.toLocaleString();
  overallAccuracyEl.textContent = `${overallAccuracy}%`;
  bestScoreEl.textContent = `${bestScore}%`;
  krok1AccuracyEl.textContent = krok1Stats.accuracy === null ? "—" : `${krok1Stats.accuracy}%`;
  krok1ExamsEl.textContent = `${krok1Stats.exams} ${krok1Stats.exams === 1 ? "exam" : "exams"}`;
  krok2AccuracyEl.textContent = krok2Stats.accuracy === null ? "—" : `${krok2Stats.accuracy}%`;
  krok2ExamsEl.textContent = `${krok2Stats.exams} ${krok2Stats.exams === 1 ? "exam" : "exams"}`;

  subjectStatsEl.innerHTML = "";
  if (!subjectStats.length) {
    subjectStatsEl.innerHTML = '<p class="subject-stats-empty">Complete a new exam to start building question-level subject statistics.</p>';
  } else {
    subjectStats.forEach(stat => {
      const row = document.createElement("div");
      row.className = "subject-stat-row";
      row.innerHTML = `<div class="subject-stat-name">${stat.subject}<small>${stat.questions} questions · ${stat.exams} ${stat.exams === 1 ? "exam" : "exams"}</small></div><div class="subject-stat-track"><div class="subject-stat-fill" style="width:${stat.accuracy}%"></div></div><div class="subject-stat-value">${stat.accuracy}%</div>`;
      subjectStatsEl.appendChild(row);
    });
  }

  renderWeakSubjects(subjectStats);

  new Chart(progressCanvas, {
    type: "line",
    data: { labels: progressLabels, datasets: [{ label: "Exam Score", data: progressScores, borderColor: "#16a34a", backgroundColor: "rgba(22, 163, 74, 0.08)", borderWidth: 3, pointRadius: 5, pointHoverRadius: 7, tension: 0.3, fill: true }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `Score: ${context.raw}%` } } }, scales: { y: { min: 0, max: 100, ticks: { callback: value => `${value}%` } }, x: { grid: { display: false } } } }
  });

  loadingSection.hidden = true;
  statisticsContent.hidden = false;
}
loadStatistics();