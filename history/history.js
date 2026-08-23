const historyLoading = document.getElementById("historyLoading");
const loginRequired = document.getElementById("loginRequired");
const emptyHistory = document.getElementById("emptyHistory");
const historyContent = document.getElementById("historyContent");
const totalExamsEl = document.getElementById("totalExams");
const totalQuestionsEl = document.getElementById("totalQuestions");
const averageScoreEl = document.getElementById("averageScore");
const examCountEl = document.getElementById("examCount");
const examList = document.getElementById("examList");
const EXAMS_PER_PAGE = 5;
let currentHistoryPage = 1;
let allExamHistory = [];

function hideAllStates() { historyLoading.hidden = true; loginRequired.hidden = true; emptyHistory.hidden = true; historyContent.hidden = true; }
function formatDate(dateString) { return new Date(dateString).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
function getScoreClass(score) { return score >= 60 ? "score-pass" : "score-fail"; }

function renderExamHistory(exams) {
  examList.innerHTML = "";
  const totalExams = exams.length;
  const totalQuestions = exams.reduce((sum, exam) => sum + Number(exam.questions_total || 0), 0);
  const averageScore = totalExams ? exams.reduce((sum, exam) => sum + Number(exam.score || 0), 0) / totalExams : 0;
  totalExamsEl.textContent = totalExams;
  totalQuestionsEl.textContent = totalQuestions;
  averageScoreEl.textContent = `${Math.round(averageScore)}%`;
  if (examCountEl) examCountEl.textContent = `${totalExams} exam${totalExams === 1 ? "" : "s"}`;

  const totalPages = Math.ceil(exams.length / EXAMS_PER_PAGE);
  if (currentHistoryPage > totalPages) currentHistoryPage = totalPages;
  const examsToShow = exams.slice((currentHistoryPage - 1) * EXAMS_PER_PAGE, currentHistoryPage * EXAMS_PER_PAGE);

  examsToShow.forEach(exam => {
    const card = document.createElement("article");
    card.className = "exam-history-card exam-history-card-clickable";
    card.tabIndex = 0;
    card.setAttribute("role", "link");
    card.setAttribute("aria-label", `Review ${exam.subject} exam`);
    card.innerHTML = `<div class="exam-history-main"><div class="exam-history-meta"><span class="exam-krok">KROK ${exam.krok}</span><span class="exam-date">${formatDate(exam.created_at)}</span></div><h3>${exam.subject}</h3><div class="exam-history-stats"><span>${exam.questions_total} Questions</span><span class="correct-text">${exam.correct} Correct</span><span class="wrong-text">${exam.wrong} Wrong</span><span class="exam-review-hint">Review exam →</span></div></div><div class="exam-history-score ${getScoreClass(Number(exam.score))}">${Math.round(Number(exam.score))}%</div>`;
    const openReview = () => { window.location.href = `exam-review.html?id=${encodeURIComponent(exam.id)}`; };
    card.addEventListener("click", openReview);
    card.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openReview(); } });
    examList.appendChild(card);
  });
  renderHistoryPagination(totalPages);
}

function renderHistoryPagination(totalPages) {
  let pagination = document.getElementById("historyPagination");
  if (!pagination) { pagination = document.createElement("div"); pagination.id = "historyPagination"; examList.after(pagination); }
  pagination.innerHTML = "";
  if (totalPages <= 1) { pagination.style.display = "none"; return; }
  pagination.style.display = "flex";
  const previousBtn = document.createElement("button"); previousBtn.textContent = "‹"; previousBtn.className = "pagination-btn pagination-arrow"; previousBtn.disabled = currentHistoryPage === 1;
  previousBtn.addEventListener("click", () => { if (currentHistoryPage > 1) { currentHistoryPage--; renderExamHistory(allExamHistory); } }); pagination.appendChild(previousBtn);
  for (let page = 1; page <= totalPages; page++) { const pageBtn = document.createElement("button"); pageBtn.textContent = page; pageBtn.className = "pagination-btn"; if (page === currentHistoryPage) pageBtn.classList.add("active"); pageBtn.addEventListener("click", () => { currentHistoryPage = page; renderExamHistory(allExamHistory); }); pagination.appendChild(pageBtn); }
  const nextBtn = document.createElement("button"); nextBtn.textContent = "›"; nextBtn.className = "pagination-btn pagination-arrow"; nextBtn.disabled = currentHistoryPage === totalPages;
  nextBtn.addEventListener("click", () => { if (currentHistoryPage < totalPages) { currentHistoryPage++; renderExamHistory(allExamHistory); } }); pagination.appendChild(nextBtn);
}

async function loadExamHistory() {
  try {
    hideAllStates(); historyLoading.hidden = false;
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError) console.error("User error:", userError);
    if (!user) { hideAllStates(); loginRequired.hidden = false; return; }
    const { data: exams, error } = await supabaseClient.from("exam_sessions").select("*").order("created_at", { ascending: false });
    if (error) { console.error("Error loading exam history:", error); historyLoading.innerHTML = "<p>Unable to load exam history.</p>"; return; }
    hideAllStates();
    if (!exams || !exams.length) { emptyHistory.hidden = false; return; }
    allExamHistory = exams; currentHistoryPage = 1; renderExamHistory(allExamHistory); historyContent.hidden = false;
  } catch (error) {
    console.error("Unexpected history error:", error); hideAllStates(); historyLoading.hidden = false; historyLoading.innerHTML = "<p>Unable to load exam history.</p>";
  }
}
loadExamHistory();