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
const progressCanvas = document.getElementById("progressCanvas");

async function loadStatistics() {
  const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
  if (userError || !user) { loadingSection.hidden = true; loginRequired.hidden = false; return; }

  const { data: sessions, error } = await supabaseClient.from("exam_sessions").select("*").eq("user_id", user.id).order("created_at", { ascending: true });
  if (error) { console.error("Error loading statistics:", error); loadingSection.innerHTML = "<p>Unable to load statistics.</p>"; return; }
  if (!sessions || sessions.length === 0) { loadingSection.hidden = true; emptyStatistics.hidden = false; return; }

  // Question-level rows are the source of truth for subject performance.
  // This makes questions from All Topics exams count toward their real subjects.
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
    // Compatibility fallback for accounts whose historical sessions predate question-level storage.
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

  new Chart(progressCanvas, {
    type: "line",
    data: { labels: progressLabels, datasets: [{ label: "Exam Score", data: progressScores, borderColor: "#16a34a", backgroundColor: "rgba(22, 163, 74, 0.08)", borderWidth: 3, pointRadius: 5, pointHoverRadius: 7, tension: 0.3, fill: true }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `Score: ${context.raw}%` } } }, scales: { y: { min: 0, max: 100, ticks: { callback: value => `${value}%` } }, x: { grid: { display: false } } } }
  });

  loadingSection.hidden = true;
  statisticsContent.hidden = false;
}
loadStatistics();