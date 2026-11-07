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
      state.screen = result.status === 'active' ? 'session' : 'dashboard';
      state.focus = command.questionId || null;
      state.progress = await state.api.progress(state.krok);
      if (!current(state)) return;
      state.busy = false;
      status.textContent = result.status === 'completed' ? 'Session completed. Your credits are saved.' : 'Session saved automatically.';
      render(state);
    } catch (error) { fail(state, error); }
  }
  const categories = ['Need Review', 'In Progress', 'Mastered'];
  const categoryOf = credits => credits === 3 ? 2 : credits === 0 ? 0 : 1;
  function rowsFor(state) {
    return state.progress.map(p => ({...p, match:state.resolver.lookupQuestion({krok:state.krok,questionId:p.question_id},state.bank)}))
      .filter(p => p.match.status === 'resolved');
  }
  function navigate(state, screen) {
    state.screen = screen; state.detail = null; render(state);
    content.querySelector('h2')?.focus({preventScroll:true});
  }
  function heading(text) {
    const h = node('h2',text); h.tabIndex = -1; return h;
  }
  function progressBar(value, max, label) {
    const bar = node('progress'); bar.max = max || 1; bar.value = value;
    bar.setAttribute('aria-label',label); return bar;
  }
  function badge(row) {
    return node('span',`${row.valid_sessions}/3 · ${categories[categoryOf(row.valid_sessions)]}`,`training-badge category-${categoryOf(row.valid_sessions)}`);
  }
  function renderDashboard(state, host, pending) {
    const counts = [0,0,0];
    state.progress.forEach(p => counts[categoryOf(p.valid_sessions)]++);
    const total = state.progress.length;
    const overview = node('div',null,'training-kpis');
    [...categories,'Total Questions'].forEach((label,index) => {
      const tile = button('',()=>{
        state.category=index;state.subject='';state.search='';navigate(state,'library');
      },`training-kpi category-${index}`);
      tile.setAttribute('aria-label',`${label}: ${index===3?total:counts[index]}. Browse ${index===3?'all':label} KROK ${state.krok} questions.`);
      tile.append(node('span',label),node('strong',String(index===3?total:counts[index])));
      tile.dataset.kpi = label; overview.append(tile);
    });
    host.append(overview);
    if(state.session?.status === 'completed') {
      const summary = node('div',null,'training-notice training-success');
      summary.append(heading('Session completed'),node('p','Your finalized session is saved. Credits below reflect your current account progress.'));
      host.append(summary);
    }
    const percent = total ? Math.round(counts[2]/total*100) : 0;
    const progress = node('section',null,'training-card training-progress');
    progress.append(heading('Your progress'));
    const ring=node('div',null,'training-progress-ring');
    ring.style.setProperty('--mastered-percent',`${percent}%`);
    ring.setAttribute('role','progressbar');ring.setAttribute('aria-label','Mastered questions');
    ring.setAttribute('aria-valuemin','0');ring.setAttribute('aria-valuemax','100');ring.setAttribute('aria-valuenow',String(percent));
    ring.setAttribute('aria-valuetext',`${percent}% mastered; ${counts[2]} of ${total} questions`);
    const center=node('div',null,'training-progress-center');
    center.append(node('strong',`${percent}%`),node('span','mastered'));ring.append(center);
    progress.append(ring,node('p',`${counts[2]} of ${total} questions mastered.`),node('small','Three credits across three completed sessions.'));
    const grid = node('div',null,'training-dashboard-grid');
    const next = node('section',null,'training-card training-next');
    next.append(node('span','BUILD YOUR CONFIDENCE','training-eyebrow'),heading('Your next training'));
    if(state.session?.status === 'active') {
      const done = state.session.answers.filter(a=>a.selectedIndex!==null).length;
      next.append(node('p',`You have an active KROK ${state.krok} session. ${done} of ${state.session.answers.length} questions answered. Your answers are saved.`));
      next.append(button('Resume Training',()=>navigate(state,'session'),'training-primary'));
    } else {
      const eligible = rowsFor(state).filter(p=>p.valid_sessions<3).sort((a,b)=>a.valid_sessions-b.valid_sessions);
      const ids = eligible.slice(0,10).map(p=>p.question_id);
      next.append(node('p',ids.length>=5?`${ids.length} questions ready for you. Start with questions that need review, then keep building your progress.`:'At least 5 distinct unmastered questions are needed for a recommended session. Keep practicing to build your review list.'));
      const start = button('Start Training',()=>void send(state,{action:'start',sessionId:crypto.randomUUID(),questionIds:ids}),'training-primary');
      start.disabled=ids.length<5 || state.busy || Boolean(pending) || state.syncBlocked;
      next.append(start);
    }
    const custom = button('Custom Training',()=>navigate(state,'custom'),'training-secondary');
    custom.disabled=state.session?.status==='active' || state.busy || Boolean(pending);
    next.append(custom,node('small','Sessions include 5–50 distinct questions. Credits are awarded only after finalization.'));
    const library = node('section',null,'training-card training-library-launch');
    library.append(node('span','YOUR QUESTION LIBRARY','training-eyebrow'),heading('A little review goes a long way.'),node('p','Browse your saved questions by subject and mastery level. Mastered questions stay available whenever you need them.'),button('Browse Questions',()=>navigate(state,'library'),'training-secondary'));
    grid.append(progress,next);host.append(grid,library);
    if(!total) {
      const empty = node('div',null,'training-notice');
      empty.append(heading('No saved questions yet'),node('p','New mistakes from signed-in Practice sessions will appear here after syncing. Your older browser archive remains in Review Mistakes.'));
      host.append(empty);
    }
  }
  function renderLibrary(state, host) {
    host.append(button('← Dashboard',()=>navigate(state,'dashboard'),'training-back'));
    const card=node('section',null,'training-card');host.append(card);
    card.append(heading('Browse Questions'),node('p','Explore your question library. Viewing a question never changes your credits.'));
    const rows=rowsFor(state);
    const tabs=node('div',null,'training-tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Mastery category');
    state.category ??= 0;
    [...categories,'All Questions'].forEach((label,index)=>{
      const count=index===3?rows.length:rows.filter(p=>categoryOf(p.valid_sessions)===index).length;
      const tab=button(`${label} (${count})`,()=>{state.category=index;state.detail=null;render(state);},'training-tab');
      tab.setAttribute('aria-pressed',String(state.category===index));tabs.append(tab);
    });
    const filters=node('div',null,'training-filters');
    const subjectLabel=node('label','Subject'),subject=node('select');subject.id='trainingSubject';subjectLabel.htmlFor=subject.id;
    const all=node('option','All subjects');all.value='';subject.append(all);
    [...new Set(rows.map(p=>p.match.question.subject))].sort().forEach(name=>{const option=node('option',name);option.value=name;subject.append(option);});
    subject.value=state.subject || '';
    const searchLabel=node('label','Search questions'),search=node('input');search.id='trainingSearch';search.type='search';search.placeholder='Search text or question ID';search.value=state.search || '';searchLabel.htmlFor=search.id;
    filters.append(subjectLabel,subject,searchLabel,search);card.append(tabs,filters);
    const results=node('p',null,'training-meta'),list=node('ul',null,'training-list');results.setAttribute('role','status');card.append(results,list);
    function update() {
      state.subject=subject.value;state.search=search.value;
      const query=search.value.trim().toLocaleLowerCase();
      const visible=rows.filter(p=>(state.category===3 || categoryOf(p.valid_sessions)===state.category) && (!subject.value || p.match.question.subject===subject.value) && (!query || `${p.match.question.question} ${p.question_id}`.toLocaleLowerCase().includes(query)));
      results.textContent=`${visible.length} questions`;list.replaceChildren();
      if(!visible.length)list.append(node('li','No questions match this category and these filters.','training-empty'));
      visible.forEach(row=>{
        const item=node('li'),copy=node('div',null,'training-question-copy');
        copy.append(node('span',`${row.match.question.subject} · ${row.question_id}`,'training-meta'),node('p',row.match.question.question,'training-preview'),badge(row));
        const inspect=button('View Question',()=>{state.detail=row.question_id;render(state);},'training-secondary');inspect.setAttribute('aria-label',`View question ${row.question_id}`);
        item.append(copy,inspect);list.append(item);
      });
    }
    subject.addEventListener('change',update);search.addEventListener('input',update);update();
    if(state.detail) {
      const row=rows.find(p=>p.question_id===state.detail);
      if(row) {
        const detail=node('section',null,'training-card training-question-detail');
        detail.append(button('Close question',()=>{state.detail=null;render(state);},'training-back'),heading('Question preview'),node('span',`${row.match.question.subject} · ${row.question_id}`,'training-meta'),badge(row),node('h3',row.match.question.question));
        const answers=node('ol');row.match.question.answers.forEach((text,index)=>{const answer=node('li',text);if(index===row.match.question.correct)answer.append(node('span',' · Correct answer','training-meta'));answers.append(answer);});
        detail.append(answers,node('p','Consultation only. No answer is submitted and no mastery credit is awarded.'));host.append(detail);
        detail.tabIndex=-1;detail.focus({preventScroll:true});detail.scrollIntoView?.({block:'start'});
      }
    }
  }
  function renderCustom(state,host,pending) {
    host.append(button('← Dashboard',()=>navigate(state,'dashboard'),'training-back'));
    const card=node('section',null,'training-card');host.append(card);
    card.append(heading('Custom Training'),node('p','Choose 5–50 distinct questions. Mastered questions may also be included.'));
    const count=node('p',null,'training-selection-count'),list=node('ul',null,'training-list training-custom-list');
    state.selection ??= new Set(rowsFor(state).filter(p=>p.valid_sessions<3).slice(0,10).map(p=>p.question_id));
    const start=button('Start Training',()=>void send(state,{action:'start',sessionId:crypto.randomUUID(),questionIds:[...state.selection]}),'training-primary');
    function update(){const n=state.selection.size;count.textContent=`${n} selected (minimum 5, maximum 50)`;start.disabled=n<5||n>50||state.busy||Boolean(pending)||state.syncBlocked||state.session?.status==='active';}
    rowsFor(state).forEach(row=>{
      const item=node('li'),label=node('label'),input=node('input'),copy=node('span');input.type='checkbox';input.value=row.question_id;input.checked=state.selection.has(row.question_id);
      input.addEventListener('change',()=>{if(input.checked)state.selection.add(row.question_id);else state.selection.delete(row.question_id);update();});
      copy.append(node('span',row.match.question.question),node('span',`${row.match.question.subject} · ${row.question_id}`,'training-meta'),badge(row));label.append(input,copy);item.append(label);list.append(item);
    });
    card.append(list,count,start);update();
  }
  function renderSession(state,host,pending) {
    host.append(button('← Dashboard',()=>navigate(state,'dashboard'),'training-back'));
    const session=state.session,answers=session.answers;
    const answeredCount=answers.filter(a=>a.selectedIndex!==null).length;
    const card=node('section',null,'training-card training-session');host.append(card);
    card.append(node('span',`KROK ${state.krok} · MISTAKE TRAINING`,'training-eyebrow'),heading('Training session'));
    let answer=answers.find(a=>a.questionId===state.focus) || answers.find(a=>a.selectedIndex===null);
    card.append(node('p',answer?`Question ${answers.indexOf(answer)+1} of ${answers.length}`:`${answers.length} of ${answers.length} questions answered`,'training-question-position'),progressBar(answeredCount,answers.length,'Session answers completed'));
    if(!answer) {
      card.append(node('h3','Ready to finish?'),node('p','All questions are answered. Finalize this session to award credits for its correct answers. No credits are added twice.'));
      const finalize=button('Finalize session',()=>void send(state,{action:'finalize',sessionId:session.sessionId}),'training-primary');finalize.disabled=state.busy||Boolean(pending);card.append(finalize);return;
    }
    const match=state.resolver.lookupQuestion({krok:state.krok,questionId:answer.questionId},state.bank);
    if(match.status!=='resolved'||match.revision!==answer.revision){card.append(node('p','The question revision is unavailable. Refresh the app before continuing.'));return;}
    const q=match.question;
    card.append(node('span',`${q.subject} · ${answer.questionId}`,'training-meta'),node('h3',q.question,'training-question-text'));
    const options=node('div',null,'training-options');
    const shuffled = TrainingRuntime.answerOptions({sessionId:session.sessionId,krok:state.krok,questionId:answer.questionId,revision:answer.revision},q.answers);
    shuffled.forEach(({text,originalIndex},displayIndex)=>{
      const option=button('',()=>void send(state,{action:'answer',sessionId:session.sessionId,questionId:answer.questionId,selectedIndex:originalIndex}),'training-answer');
      option.append(node('span',String.fromCharCode(65+displayIndex),'training-option-letter'),node('span',text,'training-option-text'));
      option.dataset.originalIndex=String(originalIndex);
      option.disabled=answer.selectedIndex!==null||state.busy||Boolean(pending);
      if(answer.selectedIndex!==null){if(originalIndex===q.correct)option.classList.add('training-correct');if(originalIndex===answer.selectedIndex&&!answer.isCorrect)option.classList.add('training-wrong');}
      options.append(option);
    });card.append(options);
    if(answer.selectedIndex!==null){
      const feedback=node('div',null,`training-feedback ${answer.isCorrect?'is-correct':'is-wrong'}`);feedback.setAttribute('role','status');
      feedback.append(node('strong',answer.isCorrect?'Correct answer':'Incorrect answer'),node('p',answer.isCorrect?'This is a correct response. Its mastery credit will be awarded when you finalize the completed session.':'The selected answer is incorrect. The correct answer is highlighted. Mastery for this question has been reset to 0/3.'));
      const next=button(answeredCount===answers.length?'Finish session':'Next Question',()=>{state.focus=null;render(state);},'training-primary');next.disabled=state.busy||Boolean(pending);card.append(feedback,next);
    }else card.append(node('p','Choose an answer to check it. Your response is saved automatically.','training-meta'));
  }
  function render(state) {
    if(!current(state))return;
    content.replaceChildren();
    content.setAttribute('aria-busy','false');
    let pending;
    try{pending=readCommand(state);}catch(error){content.append(node('p',error.message));return;}
    if(pending){const notice=node('div',null,'training-notice');notice.append(node('p','A saved request is waiting for confirmation. Retry keeps the same session and answer.'));const retry=button('Retry saved request',()=>void send(state,pending),'training-secondary');retry.disabled=state.busy;notice.append(retry);content.append(notice);}
    if(state.screen==='session'&&state.session?.status==='active')renderSession(state,content,pending);
    else if(state.screen==='library')renderLibrary(state,content);
    else if(state.screen==='custom')renderCustom(state,content,pending);
    else renderDashboard(state,content,pending);
  }
  async function load() {
    const state={owner,version:++version,krok:Number(selector.value),session:null,progress:[],busy:true,syncBlocked:false,screen:'dashboard'};
    view=state;content.replaceChildren();syncStatus.textContent='';
    history.replaceState(null,'',`?krok=${state.krok}`);
    if(!owner){
      status.textContent='Sign in to access your Mistake Training.';
      content.setAttribute('aria-busy','false');
      const card=node('section',null,'training-card');
      const link=node('a','Sign in →');link.href='account.html';
      card.append(heading('Your progress, across every visit'),node('p','Sign in to review your saved Practice mistakes and continue your training. Browser-only guest mistakes stay in Practice Review Mistakes.'),link);
      content.append(card);return;
    }
    status.textContent='Loading your saved training…';
    content.setAttribute('aria-busy','true');
    content.append(node('div','Loading your dashboard…','training-card training-loading'));
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
      content.setAttribute('aria-busy','false');
      content.replaceChildren(node('p','Training could not be loaded. Refresh / retry to reconnect.','training-card training-notice'));
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
