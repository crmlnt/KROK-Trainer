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
      async recordPractice(userId, eventId, krok, questionId) {
        const { data, error } = await supabase.rpc('mistake_training_record_practice', {
          p_user_id: userId, p_event_id: eventId, p_krok: krok, p_question_id: questionId
        });
        if (error) throw error;
        return data;
      },
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
        const progress = [];
        // Stay below PostgREST's default row limit; preserve all saved identities.
        for (let offset = 0; ; offset += 500) {
          const { data, error } = await supabase.from('mistake_training_progress')
            .select('question_id,valid_sessions,updated_at').eq('krok', krok)
            .order('question_id').range(offset, offset + 499);
          if (error) throw error;
          progress.push(...data);
          if (data.length < 500) return progress;
        }
      }
    });
  }
  return Object.freeze({ createClient });
});
