'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const Runtime=require('../../mistake-training-runtime');
const Identity=require('../../question-identity');
const root=path.resolve(__dirname,'../..');
const memory=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let i=0;i<150;i++){if(check())return;await new Promise(r=>setTimeout(r,2));}throw new Error('UI did not reach expected state');}

test('outbox preserves retry IDs, concurrent adds, user separation and reload',async()=>{
 const storage=memory(),calls=[];let fail=true,sequence=0;
 const api={recordPractice:async(...args)=>{calls.push(args);if(fail)throw new Error('offline');}};
 const create=userId=>Runtime.createQueue({storage,userId,api,uuid:()=>`event-${++sequence}`});
 const a=create('A');a.add(1,'main:1');
 await assert.rejects(a.flush(),/offline/);assert.equal(a.pending(),1);
 const b=create('B');assert.equal(b.pending(),0);b.add(2,'main:krok2-0001');
 fail=false;const reloaded=create('A');await Promise.all([reloaded.flush(),reloaded.flush()]);
 assert.equal(reloaded.pending(),0);assert.equal(b.pending(),1);assert.deepEqual(calls[0],calls[1]);
 let release;const slow=Runtime.createQueue({storage,userId:'C',uuid:()=>`event-${++sequence}`,api:{recordPractice:()=>new Promise(r=>{release=r;})}});
 slow.add(1,'main:1');const pending=slow.flush();await tick();slow.add(1,'main:2');release();
 await tick();release();await pending;assert.equal(slow.pending(),0);
});

test('identity guard excludes papers and preserves typed KROK IDs; token callback rejects account changes',async()=>{
 assert.equal(Runtime.practiceIdentity(Identity,{krok:1,record:{id:891,subject:'Past Paper 2015'}}),null);
 assert.equal(Runtime.practiceIdentity(Identity,{krok:1,pastPaper:true,record:{id:891,subject:'Physiology'}}),null);
 assert.equal(Runtime.practiceIdentity(Identity,{krok:1,record:{id:891,subject:'Physiology'}}),'main:891');
 assert.equal(Runtime.practiceIdentity(Identity,{krok:2,record:{id:'krok2-0001',subject:'Medicine'}}),'main:krok2-0001');
 let session={user:{id:'A'},access_token:'token-A'},options;
 Runtime.scopedClient((_url,_key,opts)=>{options=opts;}, {getSession:async()=>({data:{session},error:null})},'url','key','A');
 assert.equal(await options.accessToken(),'token-A');
 session={user:{id:'B'},access_token:'token-B'};await assert.rejects(options.accessToken(),/Account changed/);
 session=null;await assert.rejects(options.accessToken(),/Account changed/);
});

function backend(){
 const banks=new Map([1,2].map(k=>[k,JSON.parse(fs.readFileSync(path.join(root,k===1?'questions.json':'krok2/questions-krok2.json')))]));
 const data=new Map(),calls=[];let failNextAnswer=false;
 const get=(owner,k)=>{const key=`${owner}:${k}`;if(!data.has(key))data.set(key,{progress:owner==='A'?banks.get(k).slice(0,5).map(q=>({question_id:`main:${q.id}`,valid_sessions:0})):[],sessions:[]});return data.get(key);};
 const createClient=(_url,_key,opts)=>{
  const user=async()=>{const token=await opts.accessToken();return token.slice(6);};
  return {
   async rpc(name,args){
    const owner=await user();calls.push({owner,name,args});const store=get(owner,args.p_krok);
    if(name==='mistake_training_record_practice')return {data:{recorded:true},error:null};
    let session=store.sessions.find(s=>s.sessionId===args.p_session_id);
    if(args.p_action==='start'){
     if(!session){session={sessionId:args.p_session_id,krok:args.p_krok,status:'active',questionIds:args.p_question_ids,answers:args.p_question_ids.map(q=>({questionId:q,revision:1,selectedIndex:null,isCorrect:null}))};store.sessions.push(session);}
    }
    if(!session)return {data:null,error:{message:'session_not_found'}};
    if(args.p_action==='answer'){
     const a=session.answers.find(a=>a.questionId===args.p_question_id);
     if(a.selectedIndex!==null && a.selectedIndex!==args.p_selected_index)return {data:null,error:{message:'idempotency_conflict'}};
     if(a.selectedIndex===null){a.selectedIndex=args.p_selected_index;a.isCorrect=banks.get(args.p_krok).find(q=>`main:${q.id}`===a.questionId).correct===a.selectedIndex;}
     if(failNextAnswer){failNextAnswer=false;return {data:null,error:{message:'response lost'}};}
    }
    if(args.p_action==='finalize'&&session.status==='active'){
     if(session.answers.some(a=>a.selectedIndex===null))return {data:null,error:{message:'session_incomplete'}};
     session.status='completed';for(const a of session.answers)if(a.isCorrect)store.progress.find(p=>p.question_id===a.questionId).valid_sessions++;
    }
    return {data:JSON.parse(JSON.stringify(session)),error:null};
   },
   from(table){let k,start=0,end=499;const query={select(){return query;},order(){return query;},range(a,b){start=a;end=b;return query;},eq(field,value){if(field==='krok')k=value;return query;},async maybeSingle(){const store=get(await user(),k);const active=store.sessions.find(s=>s.status==='active');return {data:active?{id:active.sessionId}:null,error:null};},then(resolve,reject){return user().then(owner=>({data:get(owner,k).progress.slice(start,end+1),error:null})).then(resolve,reject);}};return query;}
  };
 };
 return {banks,calls,createClient,get,loseNextAnswer(){failNextAnswer=true;}};
}
async function page(t,server,{storage={},user='A',krok=1,fetchError=false}={}){
 const dom=new JSDOM(fs.readFileSync(path.join(root,'mistake-training.html'),'utf8'),{runScripts:'outside-only',url:`https://example.test/mistake-training.html?krok=${krok}`});
 const w=dom.window,errors=[];w.addEventListener('error',e=>errors.push(e.error));t.after(()=>{w.close();assert.deepEqual(errors,[]);});
 for(const [k,v] of Object.entries(storage))w.localStorage.setItem(k,v);
 let session=user?{user:{id:user},access_token:`token-${user}`}:null,listener;
 w.stub={auth:{getSession:async()=>({data:{session},error:null}),onAuthStateChange(fn){listener=fn;}}};
 w.supabase={createClient:server.createClient};
 w.fetch=async url=>({ok:!fetchError,json:async()=>url==='questions.json'?server.banks.get(1):url==='krok2/questions-krok2.json'?server.banks.get(2):JSON.parse(fs.readFileSync(path.join(root,url),'utf8'))});
 vm.runInContext('const supabaseClient=window.stub;const SUPABASE_URL="https://test.invalid";const SUPABASE_KEY="public";',dom.getInternalVMContext());
 for(const file of ['question-identity.js','mistake-training.js','mistake-training-runtime.js','components/mistake-training-page.js'])w.eval(fs.readFileSync(path.join(root,file),'utf8'));
 await until(()=>!w.document.getElementById('trainingStatus').textContent.startsWith('Loading'));
 const buttons=()=>[...w.document.querySelectorAll('#trainingContent button')];
 return {w,buttons,click(text){const button=buttons().find(b=>b.textContent===text);assert.ok(button,`button ${text}`);assert.equal(button.disabled,false);button.click();},snapshot:()=>Object.fromEntries(Array.from({length:w.localStorage.length},(_,i)=>{const k=w.localStorage.key(i);return[k,w.localStorage.getItem(k)];})),account(next){session=next?{user:{id:next},access_token:`token-${next}`}:null;listener('SIGNED_IN',session);}};
}

test('UI selects five, starts, recovers a lost answer across refresh, finalizes and isolates accounts/KROKs',async t=>{
 const server=backend();const p=await page(t,server);
 p.click('Custom Training');
 assert.equal(p.w.document.querySelectorAll('input:checked').length,5);
 const first=p.w.document.querySelector('input');first.checked=false;first.dispatchEvent(new p.w.Event('change'));
 assert.equal(p.buttons().find(b=>b.textContent==='Start Training').disabled,true);
 first.checked=true;first.dispatchEvent(new p.w.Event('change'));p.click('Start Training');
 await until(()=>p.w.document.querySelectorAll('.training-answer').length===5);
 server.loseNextAnswer();p.w.document.querySelector('.training-answer[data-original-index="0"]').click();
 await until(()=>p.w.document.getElementById('trainingStatus').textContent==='response lost');
 assert.ok(Object.keys(p.snapshot()).some(k=>k.startsWith('krok.mt.command')));
 const r=await page(t,server,{storage:p.snapshot()});
 r.click('Resume Training');
 await until(()=>r.buttons().some(b=>b.textContent==='Next Question'));
 assert.equal(server.get('A',1).sessions.length,1);
 const answers=server.calls.filter(c=>c.args.p_action==='answer');assert.deepEqual(JSON.parse(JSON.stringify(answers[0])),JSON.parse(JSON.stringify(answers[1])));
 r.click('Next Question');
 for(let i=1;i<5;i++){
  await until(()=>r.w.document.querySelector('.training-answer:not(:disabled)'));
  r.w.document.querySelector('.training-answer[data-original-index="0"]').click();
  await until(()=>r.buttons().some(b=>b.textContent===(i===4?'Finish session':'Next Question')&&!b.disabled));
  r.click(i===4?'Finish session':'Next Question');
 }
 r.click('Finalize session');await until(()=>r.w.document.getElementById('trainingStatus').textContent.includes('Session completed'));
 assert.ok(server.get('A',1).progress.every(p=>p.valid_sessions===1));
 r.account('B');assert.equal(r.w.document.getElementById('trainingContent').textContent,'');
 await until(()=>r.w.document.getElementById('trainingContent').textContent.includes('No saved questions yet'));
 assert.ok(!r.w.document.getElementById('trainingContent').textContent.includes('1 / 3 credits'));
 r.account(null);await until(()=>r.w.document.getElementById('trainingStatus').textContent.includes('Sign in'));
 const k2=await page(t,server,{krok:2});
 k2.click('Custom Training');
 assert.ok([...k2.w.document.querySelectorAll('input')].every(input=>input.value.startsWith('main:krok2-')));
 k2.click('Start Training');await until(()=>k2.w.document.querySelectorAll('.training-answer').length===5);
 assert.equal(server.get('A',2).sessions.length,1);
 assert.equal(server.get('A',1).sessions[0].status,'completed');
});

test('Practice sync queues missing-RPC errors, excludes guests/papers, and never replays another account',async t=>{
 const dom=new JSDOM('<p id="trainingSyncStatus"></p><button id="trainingSyncRetry" hidden></button><a id="mistakeTrainingLink"></a>',{runScripts:'outside-only',url:'https://example.test/practice.html?exam=krok2'});
 const w=dom.window;t.after(()=>w.close());
 let session={user:{id:'A'},access_token:'token-A'},listener,missing=true;const calls=[];
 w.stub={auth:{getSession:async()=>({data:{session},error:null}),onAuthStateChange(fn){listener=fn;}}};
 w.supabase={createClient:(_url,_key,options)=>({rpc:async(name,args)=>{
  const token=await options.accessToken();calls.push({token,args:JSON.parse(JSON.stringify(args))});
  return missing?{data:null,error:{code:'PGRST202',message:'RPC missing'}}:{data:{recorded:true},error:null};
 }})};
 vm.runInContext('const supabaseClient=window.stub;const SUPABASE_URL="url";const SUPABASE_KEY="key";',dom.getInternalVMContext());
 for(const file of ['question-identity.js','mistake-training.js','mistake-training-runtime.js','components/practice-training-sync.js'])w.eval(fs.readFileSync(path.join(root,file),'utf8'));
 await tick();
 const emit=(subject='Medicine')=>w.document.dispatchEvent(new w.CustomEvent('practice-mistake-recorded',{detail:{krok:2,record:{id:'krok2-0001',subject},pastPaper:false}}));
 emit();await until(()=>w.document.getElementById('trainingSyncStatus').textContent.includes('database update'));
 assert.equal(JSON.parse(w.localStorage.getItem('krok.mt.events.v1:A')).length,1);
 emit('Past Paper 2015');assert.equal(JSON.parse(w.localStorage.getItem('krok.mt.events.v1:A')).length,1);
 session=null;listener('SIGNED_OUT',session);emit();await tick();assert.equal(w.localStorage.getItem('krok.mt.events.v1:null'),null);
 session={user:{id:'B'},access_token:'token-B'};listener('SIGNED_IN',session);await tick();assert.ok(calls.every(c=>c.token==='token-A'));
 missing=false;session={user:{id:'A'},access_token:'token-A'};listener('SIGNED_IN',session);
 await until(()=>w.localStorage.getItem('krok.mt.events.v1:A')==='[]');
 assert.deepEqual(calls[0],calls[calls.length-1]);
 assert.match(w.document.getElementById('mistakeTrainingLink').href,/krok=2/);
});

test('progress reads beyond the PostgREST page limit without dropping identities',async()=>{
 const rows=Array.from({length:1203},(_,i)=>({question_id:`main:${i+1}`,valid_sessions:0}));
 const ranges=[];
 const api=require('../../mistake-training').createClient({from(){let start,end;const q={select(){return q;},eq(){return q;},order(){return q;},range(a,b){start=a;end=b;ranges.push([a,b]);return q;},then(resolve,reject){return Promise.resolve({data:rows.slice(start,end+1),error:null}).then(resolve,reject);}};return q;}});
 assert.deepEqual(await api.progress(1),rows);
 assert.deepEqual(ranges,[[0,499],[500,999],[1000,1499]]);
});

test('a stale answer from another tab reconciles even after server finalization',async t=>{
 const server=backend();
 const ids=[1,2,3,4,5].map(n=>`main:${n}`);
 const sessionId='10000000-0000-0000-0000-000000000009';
 server.get('A',1).sessions.push({sessionId,krok:1,status:'completed',questionIds:ids,answers:ids.map(questionId=>({questionId,revision:1,selectedIndex:0,isCorrect:true}))});
 const command={action:'answer',sessionId,questionId:'main:1',selectedIndex:1};
 const p=await page(t,server,{storage:{'krok.mt.command.v1:A:1':JSON.stringify(command)}});
 await until(()=>p.w.document.getElementById('trainingContent').textContent.includes('Session completed'));
 assert.equal(p.w.localStorage.getItem('krok.mt.command.v1:A:1'),null);
 assert.equal(server.get('A',1).sessions[0].answers[0].selectedIndex,0);
 assert.ok(server.get('A',1).progress.every(row=>row.valid_sessions===0));
});

test('UI sends the original nonzero bank answer index and displays server feedback',async t=>{
 const server=backend();
 const p=await page(t,server);
 p.click('Start Training');
 await until(()=>p.w.document.querySelectorAll('.training-answer').length===5);
 const option=p.w.document.querySelector('.training-answer[data-original-index="3"]');
 const question=server.banks.get(1)[0];
 assert.equal(option.querySelector('.training-option-text').textContent,question.answers[3]);
 option.click();
 await until(()=>p.w.document.querySelector('.training-feedback'));
 const request=server.calls.find(c=>c.args.p_action==='answer');
 assert.equal(request.args.p_selected_index,3);
 assert.equal('is_correct' in request.args,false);
 assert.match(p.w.document.querySelector('.training-feedback').textContent,/Incorrect/);
 assert.equal(p.w.document.querySelector('.training-wrong .training-option-text').textContent,question.answers[3]);
 assert.equal(p.w.document.querySelector('.training-correct .training-option-text').textContent,question.answers[question.correct]);
});

test('dashboard KPIs use account progress, handle zero and fewer than five eligible questions',async t=>{
 const server=backend();
 server.get('A',1).progress.forEach((row,i)=>{row.valid_sessions=[0,1,2,3,3][i];});
 const p=await page(t,server,{storage:{errors:JSON.stringify(Array(80).fill({question:'Legacy mistake'}))}});
 const kpi=name=>p.w.document.querySelector(`[data-kpi="${name}"] strong`).textContent;
 assert.equal(kpi('Need Review'),'1');assert.equal(kpi('In Progress'),'2');assert.equal(kpi('Mastered'),'2');assert.equal(kpi('Total Questions'),'5');
 assert.equal(p.w.document.querySelector('.training-progress-ring').getAttribute('aria-valuenow'),'40');
 assert.equal(p.buttons().find(b=>b.textContent==='Start Training').disabled,true);
 assert.match(p.w.document.querySelector('.training-next').textContent,/At least 5 distinct unmastered/);
 assert.equal(server.calls.length,0);
 const empty=await page(t,server,{user:'B'});
 assert.equal(empty.w.document.querySelector('[data-kpi="Total Questions"] strong').textContent,'0');
 assert.equal(empty.w.document.querySelector('.training-progress-ring').getAttribute('aria-valuenow'),'0');
 assert.equal(empty.w.document.querySelector('.training-progress-ring').style.getPropertyValue('--mastered-percent'),'0%');
 assert.equal(empty.buttons().find(b=>b.textContent==='Start Training').disabled,true);
 const guest=await page(t,server,{user:null});
 assert.match(guest.w.document.getElementById('trainingContent').textContent,/Sign in/);
 assert.equal(guest.w.document.querySelector('[data-kpi]'),null);
});

test('library filters preserve duplicate IDs and mastered questions; consultation has no write effects',async t=>{
 const server=backend();
 server.banks.get(1)[1]={...server.banks.get(1)[1],question:server.banks.get(1)[0].question,subject:'Other subject'};
 server.get('A',1).progress.forEach((row,i)=>{row.valid_sessions=[0,0,1,2,3][i];});
 const p=await page(t,server);
 p.click('Browse Questions');
 assert.equal(p.w.document.querySelectorAll('.training-list li').length,2);
 assert.match(p.w.document.querySelector('.training-list').textContent,/main:1/);
 assert.match(p.w.document.querySelector('.training-list').textContent,/main:2/);
 const search=p.w.document.getElementById('trainingSearch');search.value='main:2';search.dispatchEvent(new p.w.Event('input'));
 assert.equal(p.w.document.querySelectorAll('.training-list button').length,1);
 const subject=p.w.document.getElementById('trainingSubject');subject.value='Other subject';subject.dispatchEvent(new p.w.Event('change'));
 assert.match(p.w.document.querySelector('.training-list').textContent,/main:2/);
 search.value='nothing matches this';search.dispatchEvent(new p.w.Event('input'));
 assert.match(p.w.document.querySelector('.training-list').textContent,/No questions match/);
 search.value='';search.dispatchEvent(new p.w.Event('input'));subject.value='';subject.dispatchEvent(new p.w.Event('change'));
 p.click('Mastered (1)');p.click('View Question');
 assert.match(p.w.document.querySelector('.training-question-detail').textContent,/3\/3 · Mastered/);
 assert.match(p.w.document.querySelector('.training-question-detail').textContent,/No answer is submitted/);
 assert.equal(server.calls.length,0);
 assert.equal(server.get('A',1).progress[4].valid_sessions,3);
 p.click('Close question');assert.equal(p.w.document.querySelector('.training-question-detail'),null);
 server.get('A',1).progress[4].valid_sessions=0; // server-side reset from a new Practice error
 p.w.document.getElementById('trainingReload').click();
 await until(()=>p.w.document.querySelector('[data-kpi="Need Review"] strong')?.textContent==='3');
 assert.equal(p.w.document.querySelector('[data-kpi="Mastered"] strong').textContent,'0');
});

test('active session has an independent dashboard resume action and correct question progress',async t=>{
 const server=backend(),ids=[1,2,3,4,5].map(n=>`main:${n}`);
 server.get('A',1).sessions.push({sessionId:'10000000-0000-0000-0000-000000000010',krok:1,status:'active',questionIds:ids,answers:ids.map((questionId,i)=>({questionId,revision:1,selectedIndex:i===0?0:null,isCorrect:i===0?true:null}))});
 const p=await page(t,server);p.click('Resume Training');
 assert.match(p.w.document.querySelector('.training-question-position').textContent,/Question 2 of 5/);
 assert.equal(p.w.document.querySelector('.training-session progress').value,1);
 p.click('← Dashboard');
 assert.ok(p.buttons().some(b=>b.textContent==='Resume Training'));
 assert.ok(server.calls.every(c=>c.args.p_action==='resume'));
 const offline=await page(t,backend(),{fetchError:true});
 assert.match(offline.w.document.getElementById('trainingStatus').textContent,/could not be loaded/);
 assert.match(offline.w.document.getElementById('trainingContent').textContent,/Refresh \/ retry/);
});

test('autonomous target navigation and Practice tools preserve the original review path',()=>{
 const html=fs.readFileSync(path.join(root,'practice.html'),'utf8');
 const dom=new JSDOM(html);
 assert.equal(dom.window.document.querySelector('.practice-error-card'),null);
 assert.equal(dom.window.document.getElementById('mistakeTrainingLink'),null);
 for(const id of ['review-btn','export-errors-btn','clear-errors-btn','exportExamLogBtn','error-count'])assert.ok(dom.window.document.getElementById(id));
 assert.equal(dom.window.document.querySelector('.practice-archive-tools').open,false);
 dom.window.close();
 const nav=new JSDOM('<aside id="appSidebar" data-root="../" data-active="mistake-training"></aside>',{runScripts:'outside-only',url:'https://example.test/notes/index.html'});
 nav.window.eval(fs.readFileSync(path.join(root,'components/sidebar.js'),'utf8'));
 const link=nav.window.document.querySelector('.sidebar-section:first-child a[href="../mistake-training.html"]');
 assert.ok(link);assert.equal(link.getAttribute('aria-current'),'page');assert.equal(link.querySelectorAll('circle').length,3);
 nav.window.close();
});

test('answer permutation is stable, versioned, nonmutating and preserves duplicate answer indices',()=>{
 const context={sessionId:'10000000-0000-0000-0000-000000000001',krok:1,questionId:'main:1',revision:1};
 const answers=['Same','Same','Third','Fourth','Fifth'];
 const options=Runtime.answerOptions(context,answers);
 assert.deepEqual(Runtime.answerOptions(context,answers),options);
 assert.deepEqual(options.map(o=>o.originalIndex).sort((a,b)=>a-b),[0,1,2,3,4]);
 assert.deepEqual(answers,['Same','Same','Third','Fourth','Fifth']);
 for(const option of options)assert.equal(option.text,answers[option.originalIndex]);
 // Pin the v1 order so a later refactor cannot silently reshuffle resumed sessions.
 assert.deepEqual(options.map(o=>o.originalIndex),[1,2,4,3,0]);
});

for(let position=0;position<5;position++)test(`correct answer in ${'ABCDE'[position]}: original RPC index, feedback, resume, retry and credits`,async t=>{
 const server=backend(),question=server.banks.get(1)[0],ids=[1,2,3,4,5].map(n=>`main:${n}`);
 let sessionId;
 for(let n=1;n<=500;n++){
  const candidate=`20000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
  if(Runtime.answerOptions({sessionId:candidate,krok:1,questionId:ids[0],revision:1},question.answers)[position].originalIndex===question.correct){sessionId=candidate;break;}
 }
 assert.ok(sessionId);
 server.get('A',1).sessions.push({sessionId,krok:1,status:'active',questionIds:ids,answers:ids.map(questionId=>({questionId,revision:1,selectedIndex:null,isCorrect:null}))});
 const p=await page(t,server);p.click('Resume Training');
 const order=()=>[...p.w.document.querySelectorAll('.training-answer')].map(o=>o.dataset.originalIndex);
 const before=order();
 assert.equal(Number(before[position]),question.correct);
 assert.equal(p.w.document.querySelectorAll('.training-option-letter')[position].textContent,'ABCDE'[position]);
 // Re-rendering and a refresh before answering must preserve exactly the same order.
 p.click('← Dashboard');p.click('Resume Training');assert.deepEqual(order(),before);
 const refreshed=await page(t,server);refreshed.click('Resume Training');
 assert.deepEqual([...refreshed.w.document.querySelectorAll('.training-answer')].map(o=>o.dataset.originalIndex),before);
 server.loseNextAnswer();refreshed.w.document.querySelectorAll('.training-answer')[position].click();
 await until(()=>refreshed.w.document.getElementById('trainingStatus').textContent==='response lost');
 const retry=await page(t,server,{storage:refreshed.snapshot()});retry.click('Resume Training');
 assert.deepEqual([...retry.w.document.querySelectorAll('.training-answer')].map(o=>o.dataset.originalIndex),before);
 assert.match(retry.w.document.querySelector('.training-feedback').textContent,/Correct answer/);
 assert.equal(retry.w.document.querySelectorAll('.training-answer')[position].classList.contains('training-correct'),true);
 const requests=server.calls.filter(c=>c.args.p_action==='answer');
 assert.equal(requests.length,2);
 assert.equal(requests[0].args.p_selected_index,question.correct);
 assert.deepEqual(JSON.parse(JSON.stringify(requests[0])),JSON.parse(JSON.stringify(requests[1])));
 assert.ok(server.get('A',1).progress.every(p=>p.valid_sessions===0));
 retry.click('Next Question');
 for(let i=1;i<5;i++){
  await until(()=>retry.w.document.querySelector('.training-answer:not(:disabled)'));
  retry.w.document.querySelector('.training-answer[data-original-index="0"]').click();
  await until(()=>retry.buttons().some(b=>b.textContent===(i===4?'Finish session':'Next Question')&&!b.disabled));
  retry.click(i===4?'Finish session':'Next Question');
 }
 retry.click('Finalize session');
 await until(()=>retry.w.document.getElementById('trainingStatus').textContent.includes('Session completed'));
 assert.ok(server.get('A',1).progress.every(p=>p.valid_sessions===1));
});

test('KPI buttons open exact categories or the full library, clearing stale filters per KROK',async t=>{
 const server=backend();server.get('A',1).progress.forEach((row,i)=>{row.valid_sessions=[0,1,2,3,3][i];});
 server.get('A',2).progress.forEach(row=>{row.valid_sessions=0;});
 const p=await page(t,server);
 for(const [name,tab,count] of [['Need Review','Need Review (1)',1],['In Progress','In Progress (2)',2],['Mastered','Mastered (2)',2],['Total Questions','All Questions (5)',5]]){
  const kpi=p.w.document.querySelector(`[data-kpi="${name}"]`);
  assert.equal(kpi.tagName,'BUTTON');assert.equal(kpi.type,'button');assert.equal(kpi.tabIndex,0);
  kpi.focus();assert.equal(p.w.document.activeElement,kpi);kpi.click();
  assert.equal(p.w.document.querySelector('.training-tab[aria-pressed="true"]').textContent,tab);
  assert.equal(p.w.document.querySelectorAll('.training-list button').length,count);
  const search=p.w.document.getElementById('trainingSearch');search.value='no matching text';search.dispatchEvent(new p.w.Event('input'));
  p.click('← Dashboard');
 }
 p.w.document.querySelector('[data-kpi="Total Questions"]').click();
 assert.equal(p.w.document.getElementById('trainingSearch').value,'');
 assert.equal(p.w.document.querySelectorAll('.training-list button').length,5);
 p.click('← Dashboard');
 const selector=p.w.document.getElementById('trainingKrok');selector.value='2';selector.dispatchEvent(new p.w.Event('change'));
 await until(()=>p.w.document.querySelector('[data-kpi="Need Review"] strong')?.textContent==='5');
 p.w.document.querySelector('[data-kpi="Total Questions"]').click();
 assert.ok([...p.w.document.querySelectorAll('.training-question-copy')].every(row=>row.textContent.includes('main:krok2-')));
 assert.equal(p.w.document.getElementById('trainingPracticeLink'),null);
 assert.equal(server.calls.length,0);
});
