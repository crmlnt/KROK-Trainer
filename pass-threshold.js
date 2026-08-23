// Official KROK passing threshold used across the application.
window.KROK_PASS_THRESHOLD = 64;

// app.js predates the shared threshold and renders the final exam result itself.
// Keep its existing exam flow intact while normalizing the displayed status to
// the shared threshold whenever the results screen is rendered.
(function normalizeExamResultStatus() {
  const observer = new MutationObserver(() => {
    const scoreEl = document.querySelector('.exam-score-value');
    const statusEl = document.querySelector('.exam-status');
    if (!scoreEl || !statusEl) return;

    const score = Number.parseInt(scoreEl.textContent, 10);
    if (!Number.isFinite(score)) return;

    statusEl.textContent = score >= window.KROK_PASS_THRESHOLD
      ? 'PASSED ✅'
      : 'FAILED ❌';
  });

  const start = () => observer.observe(document.body, { childList: true, subtree: true });
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();