(() => {
  const authGate = document.getElementById("notesAuthGate");
  const content = document.getElementById("notesContent");
  const list = document.getElementById("notesList");
  const empty = document.getElementById("notesEmpty");
  const count = document.getElementById("notesCount");
  const search = document.getElementById("notesSearch");
  const krokFilter = document.getElementById("notesKrokFilter");
  const subjectFilter = document.getElementById("notesSubjectFilter");

  let notes = [];
  let questionMap = new Map();

  const normalizeKey = (krok, id) => {
    const raw = String(id);
    if (Number(krok) === 2) return raw.startsWith("krok2-") ? raw : `krok2-${raw}`;
    return raw.startsWith("krok1-") ? raw : `krok1-${raw}`;
  };

  async function loadQuestionMap() {
    const [k1, k2] = await Promise.all([
      fetch("../questions.json").then(r => r.json()),
      fetch("../krok2/questions-krok2.json").then(r => r.json())
    ]);
    k1.forEach(q => questionMap.set(normalizeKey(1, q.id), { ...q, krok: 1 }));
    k2.forEach(q => questionMap.set(normalizeKey(2, q.id), { ...q, krok: 2 }));
  }

  function formatDate(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat("en", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
  }

  function populateSubjects() {
    const subjects = [...new Set(notes.map(n => questionMap.get(n.question_id)?.subject).filter(Boolean))].sort();
    subjectFilter.innerHTML = '<option value="all">All subjects</option>' + subjects.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function render() {
    const term = search.value.trim().toLowerCase();
    const krok = krokFilter.value;
    const subject = subjectFilter.value;

    const filtered = notes.filter(note => {
      const q = questionMap.get(note.question_id);
      const subjectName = q?.subject || "Unknown subject";
      const matchesText = !term || note.note.toLowerCase().includes(term) || (q?.question || "").toLowerCase().includes(term) || subjectName.toLowerCase().includes(term);
      const matchesKrok = krok === "all" || String(note.krok) === krok;
      const matchesSubject = subject === "all" || subjectName === subject;
      return matchesText && matchesKrok && matchesSubject;
    });

    count.textContent = `${filtered.length} ${filtered.length === 1 ? "note" : "notes"}`;
    list.innerHTML = filtered.map(note => {
      const q = questionMap.get(note.question_id);
      const subjectName = q?.subject || "Unknown subject";
      const questionText = q?.question || `Question ${note.question_id}`;
      const openUrl = `../practice.html?exam=${Number(note.krok) === 2 ? "krok2" : "krok1"}&question=${encodeURIComponent(note.question_id)}`;
      return `<article class="note-card">
        <div class="note-card-top"><div class="note-card-meta"><span class="note-chip">KROK ${note.krok}</span><span class="note-chip subject">${escapeHtml(subjectName)}</span></div><span class="note-date">Updated ${formatDate(note.updated_at)}</span></div>
        <p class="note-question">${escapeHtml(questionText)}</p>
        <p class="note-text">${escapeHtml(note.note)}</p>
        <div class="note-actions"><a href="${openUrl}">Open question →</a></div>
      </article>`;
    }).join("");

    empty.hidden = filtered.length !== 0;
  }

  async function init() {
    try {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) {
        authGate.hidden = false;
        content.hidden = true;
        return;
      }

      await loadQuestionMap();
      const { data, error } = await supabaseClient
        .from("question_notes")
        .select("id,question_id,krok,note,created_at,updated_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      notes = data || [];
      populateSubjects();
      content.hidden = false;
      render();
    } catch (error) {
      console.error("Error loading My Notes:", error);
      authGate.hidden = false;
      authGate.querySelector("h2").textContent = "Unable to load notes";
      authGate.querySelector("p").textContent = "Please refresh the page and try again.";
      authGate.querySelector("a").hidden = true;
    }
  }

  search.addEventListener("input", render);
  krokFilter.addEventListener("change", render);
  subjectFilter.addEventListener("change", render);
  init();
})();