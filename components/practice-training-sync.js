(() => {
  'use strict';
  const status = document.getElementById('trainingSyncStatus');
  const retry = document.getElementById('trainingSyncRetry');
  const link = document.getElementById('mistakeTrainingLink');
  const krok = new URLSearchParams(location.search).get('exam') === 'krok2' ? 2 : 1;
  if (link) link.href = `mistake-training.html?krok=${krok}`;
  let owner = null, queue = null, generation = 0;
  const show = text => { if (status) status.textContent = text; };
  async function flush() {
    const current = queue, version = generation;
    if (!current) return;
    try {
      await current.flush();
      if (version !== generation) return;
      show('Mistake Training is up to date.');
      if (retry) retry.hidden = true;
    } catch (error) {
      if (version !== generation) return;
      show(TrainingRuntime.friendlyError(error));
      if (retry) retry.hidden = false;
    }
  }
  function account(session) {
    const next = session?.user?.id || null;
    if (owner === next && queue) return;
    owner = next; queue = null; generation++;
    if (retry) retry.hidden = true;
    if (!owner) { show('Sign in to save new mistakes to Mistake Training.'); return; }
    const scoped = TrainingRuntime.scopedClient(supabase.createClient, supabaseClient.auth, SUPABASE_URL, SUPABASE_KEY, owner);
    queue = TrainingRuntime.createQueue({ storage: localStorage, userId: owner,
      api: MistakeTraining.createClient(scoped), uuid: () => crypto.randomUUID() });
    setTimeout(() => void flush(), 0);
  }
  // Queue setup is synchronous; defer network/Auth calls outside the SDK callback.
  let authVersion = 0;
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    authVersion++;
    account(session);
  });
  const initial = authVersion;
  supabaseClient.auth.getSession().then(({data,error}) => {
    if (initial !== authVersion) return;
    if (error) show(error.message); else account(data.session);
  }).catch(error => show(TrainingRuntime.friendlyError(error)));
  document.addEventListener('practice-mistake-recorded', event => {
    if (!owner || !queue) return;
    const questionId = TrainingRuntime.practiceIdentity(QuestionIdentity, event.detail);
    if (!questionId) return;
    try { queue.add(event.detail.krok, questionId); void flush(); }
    catch (error) { show(`Training sync could not be queued: ${error.message}. The Practice archive is unchanged.`); }
  });
  retry?.addEventListener('click', () => void flush());
  window.addEventListener('online', () => void flush());
})();
