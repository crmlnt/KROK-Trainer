const ActiveSession = {
  getKey() {
    const params = new URLSearchParams(window.location.search);
    const krok = params.get("exam") === "krok2" ? "krok2" : "krok1";
    const mode = params.get("mode") === "exam" ? "exam" : "practice";
    return `${krok}_active_${mode}`;
  },

  shouldIgnore() {
    if (typeof reviewMode !== 'undefined' && reviewMode) return true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("question") && params.get("mode") !== "exam") return true;
    return false;
  },

  save() {
    if (this.shouldIgnore()) return;
    if (typeof questions === 'undefined' || !questions || questions.length === 0) return;
    if (typeof currentQuestionIndex === 'undefined') return;

    const btns = Array.from(document.querySelectorAll('.answer-btn'));
    if (btns.length === 0 && !answered) return;

    const state = {
      version: 1,
      mode: (typeof examMode !== 'undefined' && examMode) ? "exam" : "practice",
      questionsIds: questions.map(q => q.id || q.question),
      currentQuestionIndex,
      score,
      correctAnswers,
      wrongAnswers,
      answered,
      
      sessionLength: typeof sessionLength !== 'undefined' ? sessionLength : "unlimited",
      sessionErrors: typeof sessionErrors !== 'undefined' ? sessionErrors : [],
      practiceSessionConfirmedCount: typeof practiceSessionConfirmedCount !== 'undefined' ? practiceSessionConfirmedCount : 0,
      isNormalPracticeSession: typeof isNormalPracticeSession !== 'undefined' ? isNormalPracticeSession : false,
      
      examSessionLog: typeof examSessionLog !== 'undefined' ? examSessionLog : [],
      aiUserAnswer: typeof aiUserAnswer !== 'undefined' ? aiUserAnswer : null,
      
      timestamp: Date.now(),
      currentOptionsOrder: btns.length > 0 ? btns.map(b => b.textContent) : null
    };

    if (typeof examMode !== 'undefined' && examMode) {
      if (window.activeSessionExpiresAt) {
        state.expiresAt = window.activeSessionExpiresAt;
      } else if (typeof examTimeRemaining !== 'undefined') {
        state.expiresAt = Date.now() + examTimeRemaining * 1000;
        window.activeSessionExpiresAt = state.expiresAt;
      }
    }
    
    localStorage.setItem(this.getKey(), JSON.stringify(state));
  },

  load() {
    if (this.shouldIgnore()) return null;
    const raw = localStorage.getItem(this.getKey());
    if (!raw) return null;
    
    try {
      const state = JSON.parse(raw);
      if (state.version !== 1 || !state.questionsIds || state.questionsIds.length === 0) return null;
      return state;
    } catch (e) {
      console.error(e);
      return null;
    }
  },

  clear() {
    localStorage.removeItem(this.getKey());
    window.activeSessionExpiresAt = null;
  }
};
