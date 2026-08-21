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

  const hasSavedMistakes = () => {
    try {
      const saved = JSON.parse(localStorage.getItem("errors") || "[]");
      return Array.isArray(saved) && saved.length > 0;
    } catch {
      return false;
    }
  };

  const setBreadcrumbLabel = (label) => {
    const current = document.querySelector(".app-breadcrumb-current");
    if (current) current.textContent = label;
  };

  const syncReviewUi = () => {
    const canReview = hasSavedMistakes();

    reviewLauncher.hidden = reviewingMistakes || !canReview;
    reviewBtn.style.display = !reviewingMistakes && canReview ? "inline-block" : "none";

    if (reviewBanner) reviewBanner.hidden = !reviewingMistakes;
    document.body.classList.toggle("review-mistakes-active", reviewingMistakes);
  };

  const restorePracticeCounters = () => {
    if (!practiceSnapshot) return;

    score = practiceSnapshot.score;
    correctAnswers = practiceSnapshot.correctAnswers;
    wrongAnswers = practiceSnapshot.wrongAnswers;

    if (Array.isArray(practiceSnapshot.errors)) {
      errors = practiceSnapshot.errors.map(item => ({ ...item }));
      updateErrorLog();
    }

    updateStats();
    const scoreEl = document.getElementById("score");
    if (scoreEl) scoreEl.textContent = `Score: ${score}`;
  };

  syncReviewUi();

  /* Review Mistakes is deliberately kept outside the normal Practice scoring.
     The quiz engine can still render/check answers, while this shell restores
     the original session counters and error log immediately afterwards. */
  confirmAnswerBtn?.addEventListener("click", () => {
    if (!reviewingMistakes) {
      queueMicrotask(syncReviewUi);
      return;
    }

    const originalSaveSubjectStats = saveSubjectStats;
    saveSubjectStats = () => {};

    queueMicrotask(() => {
      saveSubjectStats = originalSaveSubjectStats;
      restorePracticeCounters();
      syncReviewUi();
    });
  }, true);

  nextBtn?.addEventListener("click", () => {
    queueMicrotask(() => {
      if (reviewingMistakes && currentQuestionIndex >= questions.length) {
        if (feedbackEl) {
          feedbackEl.textContent = "Review complete. You have reviewed all saved mistakes.";
        }
      }
      syncReviewUi();
    });
  });

  subjectFilter?.addEventListener("change", () => {
    reviewingMistakes = false;
    practiceSnapshot = null;
    setBreadcrumbLabel("Practice Mode");
    queueMicrotask(syncReviewUi);
  });

  reviewBtn.addEventListener("click", () => {
    practiceSnapshot = {
      score,
      correctAnswers,
      wrongAnswers,
      errors: errors.map(item => ({ ...item }))
    };

    reviewingMistakes = true;
    setBreadcrumbLabel("Review Mistakes");

    /* app.js starts review first. Rebuild the review question objects here with
       their subject metadata, which the legacy review mapper omits. */
    questions = errors.map(error => ({
      id: error.id,
      subject: error.subject || "Unknown",
      question: error.question,
      answers: error.answers,
      correct: error.correct
    }));
    currentQuestionIndex = 0;
    answered = false;
    reviewMode = true;

    if (questions.length > 0) showQuestion();
    queueMicrotask(syncReviewUi);
  });

  backToPracticeBtn?.addEventListener("click", () => {
    reviewingMistakes = false;
    setBreadcrumbLabel("Practice Mode");

    restorePracticeCounters();
    practiceSnapshot = null;

    if (typeof resetTrainer === "function") {
      resetTrainer();
    }

    syncReviewUi();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  const clearErrorsBtn = document.getElementById("clear-errors-btn");
  clearErrorsBtn?.addEventListener("click", () => {
    setTimeout(syncReviewUi, 0);
  });
})();
