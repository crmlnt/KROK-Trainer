(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MistakeTraining = factory();
})(typeof globalThis === 'undefined' ? this : globalThis, function() {
  'use strict';
  function createClient(supabase) {
    async function call(action, krok, sessionId, extra = {}) {
      const { data, error } = await supabase.rpc('mistake_training', {
        p_action: action, p_krok: krok, p_session_id: sessionId, ...extra
      });
      if (error) throw error;
      return data;
    }
    return Object.freeze({
      // Persist sessionId BEFORE starting; reuse it on network retries.
      start: (krok, sessionId, questionIds) => call('start', krok, sessionId, { p_question_ids: questionIds }),
      resume: (krok, sessionId) => call('resume', krok, sessionId),
      answer: (krok, sessionId, questionId, selectedIndex) => call('answer', krok, sessionId, { p_question_id: questionId, p_selected_index: selectedIndex }),
      finalize: (krok, sessionId) => call('finalize', krok, sessionId),
      async active(krok) {
        const { data, error } = await supabase.from('mistake_training_sessions').select('*').eq('krok', krok).eq('status', 'active').maybeSingle();
        if (error) throw error;
        return data;
      },
      async progress(krok) {
        const { data, error } = await supabase.from('mistake_training_progress').select('question_id,valid_sessions,updated_at').eq('krok', krok);
        if (error) throw error;
        return data;
      }
    });
  }
  return Object.freeze({ createClient });
});
