const reviewLoading = document.getElementById("reviewLoading");
const reviewUnavailable = document.getElementById("reviewUnavailable");
const reviewUnavailableText = document.getElementById("reviewUnavailableText");
const reviewContent = document.getElementById("reviewContent");
const reviewSubtitle = document.getElementById("reviewSubtitle");
const reviewSummary = document.getElementById("reviewSummary");
const reviewQuestions = document.getElementById("reviewQuestions");
const showAllBtn = document.getElementById("showAllBtn");
const showWrongBtn = document.getElementById("showWrongBtn");

let savedQuestions = [];
let questionBank = [];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
}

function showUnavailable(message) {
  reviewLoading.hidden = true;
  reviewContent.hidden = true;
  reviewUnavailableText.textContent = message;
  reviewUnavailable.hidden = false;
}

function findQuestion(saved) {
  return questionBank.find(q => String(q.id) === String(saved.question_id));
}

function renderQuestions(mistakesOnly = false) {
  const rows = mistakesOnly ? savedQuestions.filter(item => !item.is_correct) : savedQuestions;
  reviewQuestions.innerHTML = "";

  rows.forEach((saved, index) => {
    const source = findQuestion(saved);
    const card = document.createElement("article");
    card.className = `review-question-card ${saved.is_correct ? "review-correct" : "review-wrong"}`;
    const questionText = source?.question || "Question text is not available in the current question bank.";
    const unanswered = !saved.user_answer;

    card.innerHTML = `
      <div class="review-question-meta"><span>Question ${index + 1}</span><span>${escapeHtml(saved.subject)}</span><span class="review-result">${saved.is_correct ? "Correct" : "Incorrect"}</span></div>
      <h3>${escapeHtml(questionText)}</h3>
      <div class="review-answer review-user-answer"><strong>Your answer</strong><span>${unanswered ? "Not answered" : escapeHtml(saved.user_answer)}</span></div>
      <div class="review-answer review-correct-answer"><strong>Correct answer</strong><span>${escapeHtml(saved.correct_answer)}</span></div>`;
    reviewQuestions.appendChild(card);
  });

  if (!rows.length) reviewQuestions.innerHTML = '<div class="review-empty">No incorrect answers in this exam. Great job!</div>';
}

async function loadReview() {
  const sessionId = new URLSearchParams(window.location.search).get("id");
  if (!sessionId || !/^\d+$/.test(sessionId)) return showUnavailable("Invalid exam session.");

  try {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return showUnavailable("Sign in to review this exam.");

    const { data: session, error: sessionError } = await supabaseClient.from("exam_sessions").select("*").eq("id", sessionId).single();
    if (sessionError || !session) return showUnavailable("This exam could not be found.");

    const { data: rows, error: rowsError } = await supabaseClient.from("exam_session_questions").select("*").eq("exam_session_id", sessionId).order("id", { ascending: true });
    if (rowsError) throw rowsError;
    if (!rows || !rows.length) return showUnavailable("Detailed review is not available for this older exam because its individual answers were not saved.");

    const bankPath = Number(session.krok) === 2 ? "../krok2/questions-krok2.json" : "../questions.json";
    const response = await fetch(bankPath);
    if (response.ok) questionBank = await response.json();

    savedQuestions = rows;
    const score = Math.round(Number(session.score || 0));
    reviewSubtitle.textContent = `KROK ${session.krok} · ${session.subject} · ${session.questions_total} questions`;
    reviewSummary.innerHTML = `<div><strong>${score}%</strong><span>Score</span></div><div><strong>${session.correct}</strong><span>Correct</span></div><div><strong>${session.wrong}</strong><span>Wrong</span></div>`;
    renderQuestions(false);
    reviewLoading.hidden = true;
    reviewContent.hidden = false;
  } catch (error) {
    console.error("Exam review error:", error);
    showUnavailable("Unable to load this exam review.");
  }
}

showAllBtn.addEventListener("click", () => { showAllBtn.classList.add("active"); showWrongBtn.classList.remove("active"); renderQuestions(false); });
showWrongBtn.addEventListener("click", () => { showWrongBtn.classList.add("active"); showAllBtn.classList.remove("active"); renderQuestions(true); });
loadReview();