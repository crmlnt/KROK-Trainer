(() => {
  if (!document.body.classList.contains("practice-session")) return;

  const reviewBtn = document.getElementById("review-btn");
  const reviewLauncher = document.getElementById("reviewMistakesLauncher");
  const reviewBanner = document.getElementById("reviewMistakesBanner");
  const backToPracticeBtn = document.getElementById("backToPracticeBtn");
  const confirmAnswerBtn = document.getElementById("confirmAnswerBtn");
  const nextBtn = document.getElementById("next-btn");
  const subjectFilter = document.getElementById("subjectFilter");
  const feedbackEl = document.getElementById("feedback");

  if (!reviewBtn || !reviewLauncher) return;

  let reviewingMistakes = false;
  let practiceSnapshot = null;

  const reviewQuestions = records => records.map(readPracticeMistake)
    .filter(record => record.correct >= 0 && record.answers.length > 0)
    .map(record => ({
      id: record.id,
      subject: record.subject || "Unknown",
      question: record.question,
      answers: [...record.answers],
      correct: record.correct
    }));

  const setBreadcrumbLabel = label => {
    const current = document.querySelector(".app-breadcrumb-current");
    if (current) current.textContent = label;
  };

  const syncReviewUi = () => {
    const canReview = reviewQuestions(errors).length > 0;
    reviewLauncher.hidden = reviewingMistakes || !canReview;
    reviewBtn.style.display = !reviewingMistakes && canReview ? "inline-block" : "none";
    if (reviewBanner) reviewBanner.hidden = !reviewingMistakes;
    document.body.classList.toggle("review-mistakes-active", reviewingMistakes);
  };

  const startReview = records => {
    if (reviewingMistakes) return;
    const selected = reviewQuestions(records);
    if (!selected.length) return;

    // Keep review questions separate from both the archive and sessionErrors.
    // Preserve the live answer nodes too: returning must not let a confirmed
    // Practice answer be submitted a second time, or lose a pending selection.
    practiceSnapshot = {
      questions, currentQuestionIndex, answered, aiUserAnswer,
      selectedAnswerButton, selectedAnswerIsCorrect,
      answerNodes: [...answersContainer.childNodes],
      feedback: feedbackEl.textContent,
      nextDisplay: nextBtn.style.display,
      confirmDisplay: confirmAnswerBtn.style.display,
      fromCompletion: !document.getElementById("practiceCompletionUI").hidden
    };
    reviewingMistakes = true;
    reviewMode = true;
    questions = selected;
    currentQuestionIndex = 0;
    answered = false;
    setBreadcrumbLabel("Review Mistakes");
    showQuestion();
    syncReviewUi();
  };

  reviewBtn.addEventListener("click", () => startReview(errors));
  document.addEventListener("practice-review-mistakes", event => startReview(event.detail.mistakes));

  confirmAnswerBtn?.addEventListener("click", () => queueMicrotask(syncReviewUi));
  nextBtn?.addEventListener("click", () => queueMicrotask(syncReviewUi));

  subjectFilter?.addEventListener("change", () => {
    reviewingMistakes = false;
    practiceSnapshot = null;
    setBreadcrumbLabel("Practice Mode");
    queueMicrotask(syncReviewUi);
  });

  backToPracticeBtn?.addEventListener("click", () => {
    if (!practiceSnapshot) return;
    const snapshot = practiceSnapshot;
    questions = snapshot.questions;
    currentQuestionIndex = snapshot.currentQuestionIndex;
    reviewMode = false;
    reviewingMistakes = false;
    setBreadcrumbLabel("Practice Mode");

    if (snapshot.fromCompletion) {
      document.getElementById("practiceSessionUI").style.display = "none";
      document.getElementById("practiceCompletionUI").hidden = false;
    } else {
      showQuestion();
      answersContainer.replaceChildren(...snapshot.answerNodes);
    }
    answered = snapshot.answered;
    aiUserAnswer = snapshot.aiUserAnswer;
    selectedAnswerButton = snapshot.selectedAnswerButton;
    selectedAnswerIsCorrect = snapshot.selectedAnswerIsCorrect;
    feedbackEl.textContent = snapshot.feedback;
    nextBtn.style.display = snapshot.nextDisplay;
    confirmAnswerBtn.style.display = snapshot.confirmDisplay;
    practiceSnapshot = null;
    syncReviewUi();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  const clearErrorsBtn = document.getElementById("clear-errors-btn");
  clearErrorsBtn?.addEventListener("click", () => queueMicrotask(syncReviewUi));
  syncReviewUi();
})();
