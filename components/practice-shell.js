(() => {
  if (!document.body.classList.contains("practice-session")) return;

  const reviewBtn = document.getElementById("review-btn");
  const confirmAnswerBtn = document.getElementById("confirmAnswerBtn");
  const nextBtn = document.getElementById("next-btn");
  const subjectFilter = document.getElementById("subjectFilter");

  if (!reviewBtn) return;

  let reviewingMistakes = false;

  const hasSavedMistakes = () => {
    try {
      const saved = JSON.parse(localStorage.getItem("errors") || "[]");
      return Array.isArray(saved) && saved.length > 0;
    } catch {
      return false;
    }
  };

  const syncReviewButton = () => {
    reviewBtn.style.display = !reviewingMistakes && hasSavedMistakes()
      ? "inline-block"
      : "none";
  };

  // app.js intentionally hides export/review actions while a question is active.
  // Restore only Review Mistakes for Practice Mode, without altering the quiz engine.
  syncReviewButton();

  confirmAnswerBtn?.addEventListener("click", () => {
    queueMicrotask(syncReviewButton);
  });

  nextBtn?.addEventListener("click", () => {
    queueMicrotask(syncReviewButton);
  });

  subjectFilter?.addEventListener("change", () => {
    reviewingMistakes = false;
    queueMicrotask(syncReviewButton);
  });

  reviewBtn.addEventListener("click", () => {
    reviewingMistakes = true;
    queueMicrotask(syncReviewButton);
  });

  const clearErrorsBtn = document.getElementById("clear-errors-btn");
  clearErrorsBtn?.addEventListener("click", () => {
    setTimeout(syncReviewButton, 0);
  });
})();
