(() => {
  const noteBtn = document.getElementById("questionNoteBtn");
  const modal = document.getElementById("questionNoteModal");
  const textarea = document.getElementById("questionNoteText");
  const title = document.getElementById("questionNoteTitle");
  const helper = document.getElementById("questionNoteHelper");
  const saveBtn = document.getElementById("saveQuestionNoteBtn");
  const deleteBtn = document.getElementById("deleteQuestionNoteBtn");
  const closeButtons = document.querySelectorAll("[data-close-question-note]");
  if (!noteBtn || !modal || !textarea || !saveBtn) return;

  let user = null;
  let currentNote = null;
  let requestToken = 0;

  const params = new URLSearchParams(window.location.search);
  const isExamMode = params.get("mode") === "exam";
  const krok = params.get("exam") === "krok2" ? 2 : 1;

  if (isExamMode) {
    noteBtn.hidden = true;
    return;
  }

  const noteIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v14H8l-4 4z"/><path d="M8 9h8M8 13h5"/></svg>';
  noteBtn.innerHTML = `${noteIcon}<span class="question-note-dot" aria-hidden="true"></span>`;

  function questionKey(question) {
    if (!question || question.id === undefined || question.id === null) return null;
    const raw = String(question.id);
    if (krok === 2) return raw.startsWith("krok2-") ? raw : `krok2-${raw}`;
    return raw.startsWith("krok1-") ? raw : `krok1-${raw}`;
  }

  function activeQuestion() {
    if (!Array.isArray(window.questions) && typeof questions === "undefined") return null;
    try { return questions[currentQuestionIndex] || null; } catch (_) { return null; }
  }

  function setState(hasNote) {
    noteBtn.classList.toggle("has-note", !!hasNote);
    noteBtn.title = hasNote ? "View note" : "Add note";
    noteBtn.setAttribute("aria-label", hasNote ? "View or edit note" : "Add note");
  }

  async function loadForCurrentQuestion() {
    const token = ++requestToken;
    currentNote = null;
    setState(false);
    const question = activeQuestion();
    const key = questionKey(question);
    if (!key || !user) return;

    const { data, error } = await supabaseClient
      .from("question_notes")
      .select("id,note,updated_at")
      .eq("user_id", user.id)
      .eq("question_id", key)
      .maybeSingle();

    if (token !== requestToken) return;
    if (error) {
      console.error("Error loading question note:", error);
      return;
    }
    currentNote = data || null;
    setState(!!currentNote);
  }

  function openModal() {
    const question = activeQuestion();
    if (!question) return;

    if (!user) {
      title.textContent = "My note";
      helper.innerHTML = 'Notes are available with a free account. <a href="account.html">Sign in to save personal notes across devices.</a>';
      textarea.value = "";
      textarea.disabled = true;
      saveBtn.hidden = true;
      deleteBtn.hidden = true;
    } else {
      title.textContent = currentNote ? "My note" : "Add note";
      helper.textContent = currentNote ? "Edit your personal note for this question." : "Add a personal note to this question.";
      textarea.disabled = false;
      textarea.value = currentNote?.note || "";
      saveBtn.hidden = false;
      saveBtn.textContent = currentNote ? "Save changes" : "Save note";
      deleteBtn.hidden = !currentNote;
      setTimeout(() => textarea.focus(), 50);
    }

    modal.hidden = false;
    document.body.classList.add("question-note-modal-open");
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove("question-note-modal-open");
  }

  async function saveNote() {
    if (!user) return;
    const question = activeQuestion();
    const key = questionKey(question);
    const note = textarea.value.trim();
    if (!key || !note) {
      textarea.focus();
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    const { data, error } = await supabaseClient
      .from("question_notes")
      .upsert({ user_id: user.id, question_id: key, krok, note }, { onConflict: "user_id,question_id" })
      .select("id,note,updated_at")
      .single();
    saveBtn.disabled = false;

    if (error) {
      console.error("Error saving question note:", error);
      saveBtn.textContent = currentNote ? "Save changes" : "Save note";
      helper.textContent = "We couldn't save this note. Please try again.";
      return;
    }

    currentNote = data;
    setState(true);
    closeModal();
  }

  async function deleteNote() {
    if (!user || !currentNote) return;
    deleteBtn.disabled = true;
    const { error } = await supabaseClient
      .from("question_notes")
      .delete()
      .eq("id", currentNote.id)
      .eq("user_id", user.id);
    deleteBtn.disabled = false;

    if (error) {
      console.error("Error deleting question note:", error);
      helper.textContent = "We couldn't delete this note. Please try again.";
      return;
    }

    currentNote = null;
    setState(false);
    closeModal();
  }

  noteBtn.addEventListener("click", openModal);
  saveBtn.addEventListener("click", saveNote);
  deleteBtn.addEventListener("click", deleteNote);
  closeButtons.forEach(btn => btn.addEventListener("click", closeModal));
  modal.addEventListener("click", event => { if (event.target === modal) closeModal(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !modal.hidden) closeModal(); });

  async function init() {
    try {
      const { data } = await supabaseClient.auth.getUser();
      user = data.user || null;
    } catch (error) {
      console.error("Error checking Notes authentication:", error);
    }
    loadForCurrentQuestion();
  }

  window.KrokQuestionNotes = { refresh: loadForCurrentQuestion };
  init();
})();