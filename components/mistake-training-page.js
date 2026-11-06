(() => {
  'use strict';
  const content = document.getElementById('trainingContent');
  const status = document.getElementById('trainingStatus');
  const syncStatus = document.getElementById('trainingSync');
  const selector = document.getElementById('trainingKrok');
  const reload = document.getElementById('trainingReload');
  selector.value = new URLSearchParams(location.search).get('krok') === '2' ? '2' : '1';
  let owner = null, version = 0, view = null;
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const button = (text, handler, className) => {
    const element = node('button', text, className);
    element.type = 'button'; element.addEventListener('click', handler); return element;
  };
  const current = state => state === view && state.version === version && state.owner === owner;
  function fail(state, error) {
    if (!current(state)) return;
    status.textContent = TrainingRuntime.friendlyError(error);
    state.busy = false;
    render(state);
  }
  function commandKey(state) { return `krok.mt.command.v1:${state.owner}:${state.krok}`; }
  function readCommand(state) {
    const value = localStorage.getItem(commandKey(state));
    return value === null ? null : JSON.parse(value);
  }
  async function execute(state, command) {
    const { action, sessionId, questionIds, questionId, selectedIndex } = command;
    if (action === 'start') return state.api.start(state.krok, sessionId, questionIds);
    if (action === 'answer') return state.api.answer(state.krok, sessionId, questionId, selectedIndex);
    if (action === 'finalize') return state.api.finalize(state.krok, sessionId);
    throw new Error('Unknown saved training command. Saved data was preserved.');
  }
  async function send(state, command) {
    if (!current(state) || state.busy) return;
    state.busy = true;
    try {
      const pending = readCommand(state);
      if (pending && JSON.stringify(pending) !== JSON.stringify(command)) throw new Error('Retry the pending request before choosing another answer.');
      localStorage.setItem(commandKey(state), JSON.stringify(command));
      render(state);
      const result = await execute(state, command);
      if (!current(state)) return;
      // Clear only the command we sent, not a command another tab may have saved.
      if (localStorage.getItem(commandKey(state)) === JSON.stringify(command)) localStorage.removeItem(commandKey(state));
      state.session = result;
      state.focus = command.questionId || null;
      state.progress = await state.api.progress(state.krok);
      if (!current(state)) return;
      state.busy = false;
      status.textContent = result.status === 'completed' ? 'Session completed. Your credits are saved.' : 'Session saved automatically.';
      render(state);
    } catch (error) { fail(state, error); }
  }
  function render(state) {
    if (!current(state)) return;
    content.replaceChildren();
    const card = node('div', null, 'training-card');
    content.append(card);
    let pending;
    try { pending = readCommand(state); } catch (error) { card.append(node('p',error.message)); return; }
    if (pending) {
      card.append(node('p', 'A saved request is waiting for confirmation. Retry keeps the same session and answer.'));
      const retry = button('Retry saved request', () => void send(state, pending), 'training-primary');
      retry.disabled = state.busy; card.append(retry);
    }
    if (state.session?.status === 'active') {
      const session = state.session;
      const answers = session.answers;
      const answeredCount = answers.filter(a => a.selectedIndex !== null).length;
      card.append(node('h2', 'Training session'),node('p', `${answeredCount} / ${answers.length} answered · KROK ${state.krok}`));
      let answer = answers.find(a => a.questionId === state.focus);
      if (!answer) answer = answers.find(a => a.selectedIndex === null);
      if (!answer) {
        card.append(node('p', 'All questions answered. Finalize to save mastery credits.'));
        const finalize = button('Finalize session', () => void send(state, { action:'finalize', sessionId:session.sessionId }), 'training-primary');
        finalize.disabled = state.busy || Boolean(pending); card.append(finalize); return;
      }
      const match = state.resolver.lookupQuestion({krok:state.krok,questionId:answer.questionId}, state.bank);
      if (match.status !== 'resolved' || match.revision !== answer.revision) {
        card.append(node('p','The question revision is unavailable. Refresh the app before continuing.')); return;
      }
      const q = match.question;
      card.append(node('span', `${q.subject} · ${answer.questionId}`, 'training-meta'),node('h3',q.question));
      q.answers.forEach((text,index) => {
        const option = button(text, () => void send(state, {action:'answer',sessionId:session.sessionId,questionId:answer.questionId,selectedIndex:index}), 'training-answer');
        option.disabled = answer.selectedIndex !== null || state.busy || Boolean(pending);
        if (answer.selectedIndex !== null) {
          if (index === q.correct) option.classList.add('training-correct');
          if (index === answer.selectedIndex && !answer.isCorrect) option.classList.add('training-wrong');
        }
        card.append(option);
      });
      if (answer.selectedIndex !== null) {
        card.append(node('p',answer.isCorrect ? 'Correct. A credit is awarded when this session is finalized.' : 'Incorrect. Mastery for this question has been reset to 0 / 3.','training-feedback'));
        const next = button(answeredCount === answers.length ? 'Finish session' : 'Next question', () => {state.focus=null;render(state);},'training-primary');
        next.disabled = state.busy || Boolean(pending); card.append(next);
      }
      return;
    }
    if (state.session?.status === 'completed') card.append(node('h2','Session completed'),node('p','Correct answers earned one credit. Three credits across distinct completed sessions mean mastered.'));
    const rows = state.progress.map(p => ({...p,match:state.resolver.lookupQuestion({krok:state.krok,questionId:p.question_id},state.bank)})).filter(p=>p.match.status==='resolved');
    card.append(node('h2','Your questions to review'));
    card.append(node('p',`${rows.length} saved questions · ${rows.filter(p=>p.valid_sessions===3).length} mastered`));
    card.append(node('p','Choose 5–50 distinct questions. Complete every question and finalize the session to earn credits.'));
    if (!rows.length) card.append(node('p','No saved questions yet. New mistakes from signed-in Practice sessions will appear here after syncing. Your older browser archive remains in Review Mistakes.'));
    const count = node('p');
    const start = button('Start training', () => {
      const questionIds = Array.from(card.querySelectorAll('input:checked')).map(input=>input.value);
      void send(state,{action:'start',sessionId:crypto.randomUUID(),questionIds});
    }, 'training-primary');
    function update() {
      const n = card.querySelectorAll('input:checked').length;
      count.textContent = `${n} selected (minimum 5, maximum 50)`;
      start.disabled = n < 5 || n > 50 || state.busy || Boolean(pending) || state.syncBlocked;
    }
    const list = node('ul', null, 'training-list');
    let selected=0;
    for (const row of rows) {
      const li=node('li'), label=node('label'), input=node('input'), copy=node('span');
      input.type='checkbox'; input.value=row.question_id;
      input.checked=row.valid_sessions<3 && selected<10;
      if(input.checked)selected++;
      input.addEventListener('change',update);
      copy.append(node('span',row.match.question.question),node('span',`${row.match.question.subject} · ${row.question_id} · ${row.valid_sessions} / 3 credits${row.valid_sessions===3?' · Mastered':''}`,'training-meta'));
      label.append(input,copy); li.append(label);list.append(li);
    }
    card.append(list,count,start);update();
  }
  async function load() {
    const state={owner,version:++version,krok:Number(selector.value),session:null,progress:[],busy:true,syncBlocked:false};
    view=state;content.replaceChildren();syncStatus.textContent='';
    document.getElementById('trainingPracticeLink').href=state.krok===2?'practice.html?exam=krok2':'practice.html';
    history.replaceState(null,'',`?krok=${state.krok}`);
    if(!owner){status.textContent='Sign in to access your Mistake Training.';content.append(node('a','Sign in →'));content.firstChild.href='account.html';return;}
    status.textContent='Loading your saved training…';
    try {
      const scoped=TrainingRuntime.scopedClient(supabase.createClient,supabaseClient.auth,SUPABASE_URL,SUPABASE_KEY,state.owner);
      state.api=MistakeTraining.createClient(scoped);
      const bankFile=state.krok===1?'questions.json':'krok2/questions-krok2.json';
      const fetchJSON=async url=>{const response=await fetch(url);if(!response.ok)throw new Error('Question bank could not be loaded. Retry.');return response.json();};
      const [bank,manifest]=await Promise.all([fetchJSON(bankFile),fetchJSON(`data/question-identity/krok${state.krok}-main.manifest.json`)]);
      if(!current(state))return;
      state.bank=bank;state.resolver=QuestionIdentity.createResolver([manifest]);
      const queue=TrainingRuntime.createQueue({storage:localStorage,userId:state.owner,api:state.api,uuid:()=>crypto.randomUUID()});
      try {await queue.flush();} catch(error) {
        if(!current(state))return;
        state.syncBlocked=true;syncStatus.textContent=TrainingRuntime.friendlyError(error)+' Retry sync before starting a new session.';
      }
      if(!current(state))return;
      const pending=readCommand(state);
      if(pending) {
        try {
          state.session=await execute(state,pending);
          if(!current(state))return;
          if(localStorage.getItem(commandKey(state))===JSON.stringify(pending))localStorage.removeItem(commandKey(state));
          state.focus=pending.questionId||null;
        } catch(error) {
          if(!current(state))return;
          status.textContent=TrainingRuntime.friendlyError(error);
          if(pending.action==='answer' && /idempotency_conflict|session_closed/.test(error.message || '')) {
            // A second tab may already have answered and finalized this session.
            const saved=await state.api.resume(state.krok,pending.sessionId);
            if(!current(state))return;
            if(saved.answers.some(a=>a.questionId===pending.questionId && a.selectedIndex!==null)) {
              if(localStorage.getItem(commandKey(state))===JSON.stringify(pending))localStorage.removeItem(commandKey(state));
              state.session=saved;state.focus=pending.questionId;
            }
          }
        }
      }
      const active=await state.api.active(state.krok);
      if(active)state.session=await state.api.resume(state.krok,active.id);
      // Another tab may have started a session or accepted a different first answer.
      // Reconcile only conflicts with authoritative server state, never drop network failures.
      const stillPending=readCommand(state);
      if(stillPending && state.session?.status==='active') {
        const savedAnswer=state.session.answers.find(a=>a.questionId===stillPending.questionId);
        const conflictingStart=stillPending.action==='start' && stillPending.sessionId!==state.session.sessionId;
        const conflictingAnswer=stillPending.action==='answer' && stillPending.sessionId===state.session.sessionId && savedAnswer?.selectedIndex!==null && savedAnswer?.selectedIndex!==undefined;
        if(conflictingStart || conflictingAnswer) {
          if(localStorage.getItem(commandKey(state))===JSON.stringify(stillPending))localStorage.removeItem(commandKey(state));
          state.focus=conflictingAnswer?stillPending.questionId:null;
          status.textContent='The server session was restored. The first saved answer is preserved.';
        }
      }
      state.progress=await state.api.progress(state.krok);
      if(!current(state))return;
      state.busy=false;
      if(!readCommand(state))status.textContent=state.session?.status==='active'?'Your active session has been resumed.':'Your training progress is saved to your account.';
      render(state);
    }catch(error){
      if(!current(state))return;
      status.textContent=TrainingRuntime.friendlyError(error);
      content.replaceChildren(node('p','Training could not be loaded. Refresh / retry to reconnect.'));
    }
  }
  selector.addEventListener('change',()=>void load());
  reload.addEventListener('click',()=>void load());
  window.addEventListener('online',()=>void load());
  window.addEventListener('storage',event=>{if(event.key?.startsWith('krok.mt.'))void load();});
  let authVersion=0;
  supabaseClient.auth.onAuthStateChange((_event,session)=>{
    const next=session?.user?.id||null;
    authVersion++;
    if(next===owner&&view)return;
    owner=next;version++;view=null;content.replaceChildren();status.textContent='Updating account…';
    const authCurrent=authVersion;
    setTimeout(()=>{if(authCurrent===authVersion)void load();},0);
  });
  const initial=authVersion;
  supabaseClient.auth.getSession().then(({data,error})=>{
    if(initial!==authVersion)return;
    if(error){status.textContent=error.message;return;}
    owner=data.session?.user?.id||null;void load();
  }).catch(error=>{status.textContent=TrainingRuntime.friendlyError(error);});
})();
