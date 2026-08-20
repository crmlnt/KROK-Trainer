(() => {
  const host = document.getElementById("appSidebar");
  if (!host) return;

  const root = host.dataset.root || "";
  const active = host.dataset.active || "";
  const drawerOnly = host.dataset.drawerOnly === "true";
  const externalTriggerId = host.dataset.trigger || "";

  if (drawerOnly) document.body.classList.add("sidebar-drawer-only");

  const icon = (name) => {
    const icons = {
      home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
      book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5A2.5 2.5 0 0 1 4.5 2H11v18H4.5A2.5 2.5 0 0 0 2 22z"/><path d="M22 4.5A2.5 2.5 0 0 0 19.5 2H13v18h6.5A2.5 2.5 0 0 1 22 22z"/></svg>',
      exam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 9h6M9 13h6M9 17h4"/></svg>',
      user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
      history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>',
      stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
      notes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v14H8l-4 4z"/><path d="M8 9h8M8 13h5"/></svg>',
      tutorial: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/></svg>',
      news: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18H6z"/><path d="M9 7h6M9 11h6M9 15h4"/></svg>',
      moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>',
      sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>'
    };
    return icons[name] || "";
  };

  const link = (key, href, label, iconName, child = false) => `
    <a class="sidebar-link ${child ? "sidebar-child-link" : ""} ${active === key ? "active" : ""}" href="${root}${href}" ${active === key ? 'aria-current="page"' : ""}>
      <span class="sidebar-icon">${icon(iconName)}</span>
      <span class="sidebar-link-label">${label}</span>
    </a>`;

  const krok1Active = active.startsWith("krok1-");
  const krok2Active = active.startsWith("krok2-");

  host.className = "app-sidebar";
  host.innerHTML = `
    <div class="sidebar-top">
      <a class="sidebar-brand" href="${root}index.html" aria-label="KROK Trainer Home">
        <span class="sidebar-brand-mark">K</span>
        <span class="sidebar-brand-text"><strong>KROK</strong><span>Trainer</span></span>
      </a>
      <button id="sidebarCollapseBtn" class="sidebar-collapse" type="button" aria-label="Collapse sidebar">‹</button>
      <button id="sidebarMobileCloseBtn" class="sidebar-mobile-close" type="button" aria-label="Close menu">×</button>
    </div>
    <div class="sidebar-scroll">
      <div class="sidebar-section">${link("home", "index.html", "Home", "home")}</div>
      <div class="sidebar-section sidebar-krok-section">
        <span class="sidebar-section-title">KROK</span>
        <button class="sidebar-krok-toggle ${krok1Active ? "open" : ""}" type="button" data-krok="1" aria-expanded="${krok1Active}"><span>KROK 1</span><span class="sidebar-chevron">›</span></button>
        <div class="sidebar-krok-children ${krok1Active ? "open" : ""}" data-krok-panel="1">${link("krok1-practice", "practice.html", "Practice Mode", "book", true)}${link("krok1-exam", "exam.html", "Exam Mode", "exam", true)}</div>
        <button class="sidebar-krok-toggle ${krok2Active ? "open" : ""}" type="button" data-krok="2" aria-expanded="${krok2Active}"><span>KROK 2</span><span class="sidebar-chevron">›</span></button>
        <div class="sidebar-krok-children ${krok2Active ? "open" : ""}" data-krok-panel="2">${link("krok2-practice", "practice.html?exam=krok2", "Practice Mode", "book", true)}${link("krok2-exam", "exam.html?exam=krok2", "Exam Mode", "exam", true)}</div>
      </div>
      <button id="sidebarKrokCollapsedBtn" class="sidebar-krok-collapsed-btn" type="button" aria-label="Open KROK menu" title="KROK">K</button>
      <div class="sidebar-section">
        <span class="sidebar-section-title">My Account</span>
        ${link("account", "account.html", "Account", "user")}${link("history", "history/history.html", "Exam History", "history")}${link("statistics", "statistics/statistics.html", "Statistics", "stats")}
        <div class="sidebar-disabled" aria-disabled="true"><span class="sidebar-icon">${icon("notes")}</span><span class="sidebar-link-label">Your Notes</span><span class="sidebar-badge">COMING SOON</span></div>
      </div>
      <div class="sidebar-section"><span class="sidebar-section-title">Resources</span>${link("tutorial", "guide.html", "Tutorial", "tutorial")}${link("news", "news.html", "News / Updates", "news")}</div>
    </div>
    <div class="sidebar-footer">
      <button id="sidebarThemeBtn" class="sidebar-theme-btn" type="button"><span id="sidebarThemeIcon" class="sidebar-icon"></span><span id="sidebarThemeLabel" class="sidebar-theme-label">Dark Mode</span></button>
      <a id="sidebarUser" class="sidebar-user" href="${root}account.html"><span class="sidebar-status-dot" aria-hidden="true"></span><span class="sidebar-user-copy"><strong id="sidebarUserEmail">Not signed in</strong><span id="sidebarUserStatus">Sign in →</span></span></a>
    </div>`;

  const overlay = document.createElement("div");
  overlay.className = "sidebar-mobile-overlay";
  overlay.setAttribute("aria-hidden", "true");
  document.body.appendChild(overlay);

  let mobileMenuBtn = externalTriggerId ? document.getElementById(externalTriggerId) : null;
  if (!mobileMenuBtn) {
    mobileMenuBtn = document.createElement("button");
    mobileMenuBtn.className = "sidebar-mobile-menu-btn";
    mobileMenuBtn.type = "button";
    mobileMenuBtn.setAttribute("aria-label", "Open navigation menu");
    mobileMenuBtn.innerHTML = '<span></span><span></span><span></span>';
    document.body.appendChild(mobileMenuBtn);
  }
  mobileMenuBtn.setAttribute("aria-expanded", "false");

  const collapseBtn = document.getElementById("sidebarCollapseBtn");
  const mobileCloseBtn = document.getElementById("sidebarMobileCloseBtn");
  const krokCollapsedBtn = document.getElementById("sidebarKrokCollapsedBtn");
  const themeBtn = document.getElementById("sidebarThemeBtn");
  const themeIcon = document.getElementById("sidebarThemeIcon");
  const themeLabel = document.getElementById("sidebarThemeLabel");

  if (!drawerOnly && localStorage.getItem("krokSidebarCollapsed") === "true") document.body.classList.add("sidebar-collapsed");
  if (localStorage.getItem("theme") === "dark") document.body.classList.add("dark-mode");

  const renderTheme = () => {
    const dark = document.body.classList.contains("dark-mode");
    themeIcon.innerHTML = icon(dark ? "sun" : "moon");
    themeLabel.textContent = dark ? "Light Mode" : "Dark Mode";
  };
  renderTheme();

  const closeMobileMenu = () => {
    document.body.classList.remove("sidebar-mobile-open");
    mobileMenuBtn.setAttribute("aria-expanded", "false");
    mobileMenuBtn.classList?.remove("open");
  };
  const openMobileMenu = () => {
    document.body.classList.remove("sidebar-collapsed");
    document.body.classList.add("sidebar-mobile-open");
    mobileMenuBtn.setAttribute("aria-expanded", "true");
    mobileMenuBtn.classList?.add("open");
  };

  mobileMenuBtn.addEventListener("click", () => {
    document.body.classList.contains("sidebar-mobile-open") ? closeMobileMenu() : openMobileMenu();
  });
  mobileCloseBtn?.addEventListener("click", closeMobileMenu);
  overlay.addEventListener("click", closeMobileMenu);
  document.addEventListener("keydown", event => { if (event.key === "Escape") closeMobileMenu(); });
  host.querySelectorAll("a.sidebar-link, .sidebar-user, .sidebar-brand").forEach(item => item.addEventListener("click", () => {
    if (drawerOnly || window.innerWidth <= 900) closeMobileMenu();
  }));

  const krokToggles = [...host.querySelectorAll(".sidebar-krok-toggle")];
  krokToggles.forEach(toggle => toggle.addEventListener("click", () => {
    const id = toggle.dataset.krok;
    const panel = host.querySelector(`[data-krok-panel="${id}"]`);
    const willOpen = !toggle.classList.contains("open");
    krokToggles.forEach(other => {
      const otherPanel = host.querySelector(`[data-krok-panel="${other.dataset.krok}"]`);
      other.classList.remove("open");
      other.setAttribute("aria-expanded", "false");
      otherPanel?.classList.remove("open");
    });
    if (willOpen) {
      toggle.classList.add("open");
      toggle.setAttribute("aria-expanded", "true");
      panel?.classList.add("open");
    }
  }));

  collapseBtn?.addEventListener("click", () => {
    if (drawerOnly) return;
    document.body.classList.toggle("sidebar-collapsed");
    localStorage.setItem("krokSidebarCollapsed", document.body.classList.contains("sidebar-collapsed"));
  });
  krokCollapsedBtn?.addEventListener("click", () => {
    document.body.classList.remove("sidebar-collapsed");
    localStorage.setItem("krokSidebarCollapsed", "false");
  });
  themeBtn?.addEventListener("click", () => {
    document.body.classList.toggle("dark-mode");
    localStorage.setItem("theme", document.body.classList.contains("dark-mode") ? "dark" : "light");
    renderTheme();
    window.dispatchEvent(new CustomEvent("krok-theme-change"));
  });

  window.addEventListener("resize", () => {
    if (!drawerOnly && window.innerWidth > 900) closeMobileMenu();
  });

  async function renderUser() {
    const userEl = document.getElementById("sidebarUser");
    const emailEl = document.getElementById("sidebarUserEmail");
    const statusEl = document.getElementById("sidebarUserStatus");
    if (typeof supabaseClient === "undefined" || !supabaseClient.auth) return;
    try {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) return;
      userEl.classList.add("signed-in");
      emailEl.textContent = user.email || "Signed in";
      emailEl.title = user.email || "";
      statusEl.textContent = "Signed in";
    } catch (error) {
      console.warn("Sidebar auth status unavailable:", error);
    }
  }
  renderUser();
})();
