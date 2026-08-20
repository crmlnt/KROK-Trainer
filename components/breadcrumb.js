(() => {
  const host = document.getElementById("appBreadcrumb");
  if (!host) return;

  const root = host.dataset.root || "";
  const section = host.dataset.section || "";
  const sectionHref = host.dataset.sectionHref || "";
  const page = host.dataset.page || document.title;

  host.className = "app-breadcrumb";
  host.setAttribute("aria-label", "Breadcrumb");

  const parts = [`<a href="${root}index.html">Home</a>`];

  if (section) {
    parts.push('<span class="app-breadcrumb-separator" aria-hidden="true">›</span>');
    parts.push(sectionHref
      ? `<a href="${root}${sectionHref}">${section}</a>`
      : `<span>${section}</span>`);
  }

  if (page) {
    parts.push('<span class="app-breadcrumb-separator" aria-hidden="true">›</span>');
    parts.push(`<span class="app-breadcrumb-current" aria-current="page">${page}</span>`);
  }

  host.innerHTML = parts.join("");

  const params = new URLSearchParams(window.location.search);
  const isExamPage = window.location.pathname.endsWith("practice.html") && params.get("mode") === "exam";

  const examIsStillRunning = () => {
    if (!isExamPage) return false;
    const resultsVisible = !!document.querySelector("#feedback .exam-summary");
    const reviewVisible = !!document.getElementById("backToExamResultsBtn");
    return !resultsVisible && !reviewVisible;
  };

  host.querySelectorAll("a").forEach(link => {
    link.addEventListener("click", event => {
      if (!examIsStillRunning()) return;
      const shouldExit = window.confirm(
        "Exit exam?\n\nYour current exam session will be terminated and will not be saved."
      );
      if (!shouldExit) event.preventDefault();
    });
  });
})();
