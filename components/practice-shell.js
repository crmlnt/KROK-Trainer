(() => {
  if (!document.body.classList.contains("practice-session")) return;

  const reviewBtn = document.getElementById("review-btn");
  const reviewLauncher = document.getElementById("reviewMistakesLauncher");
  const reviewBanner = document.getElementById("reviewMistakesBanner");
  const backToPracticeBtn = document.getElementById("backToPracticeBtn");
  const confirmAnswerBtn = document.getElementById("confirmAnswerBtn");
  const nextBtn = document.getElementById("next-btn");
  const subjectFilter = document.getElementById("subjectFilter");

  if (!reviewBtn || !reviewLauncher) return;

  let reviewingMistakes = false;

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

  syncReviewUi();

  confirmAnswerBtn?.addEventListener("click", () => {
    queueMicrotask(syncReviewUi);
  });

  nextBtn?.addEventListener("click", () => {
    queueMicrotask(syncReviewUi);
  });

  subjectFilter?.addEventListener("change", () => {
    reviewingMistakes = false;
    setBreadcrumbLabel("Practice Mode");
    queueMicrotask(syncReviewUi);
  });

  reviewBtn.addEventListener("click", () => {
    reviewingMistakes = true;
    setBreadcrumbLabel("Review Mistakes");
    queueMicrotask(syncReviewUi);
  });

  backToPracticeBtn?.addEventListener("click", () => {
    reviewingMistakes = false;
    setBreadcrumbLabel("Practice Mode");

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
