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
async function page(t,server,{storage={},user='A',krok=1}={}){
 const dom=new JSDOM(fs.readFileSync(path.join(root,'mistake-training.html'),'utf8'),{runScripts:'outside-only',url:`https://example.test/mistake-training.html?krok=${krok}`});
 const w=dom.window,errors=[];w.addEventListener('error',e=>errors.push(e.error));t.after(()=>{w.close();assert.deepEqual(errors,[]);});
 for(const [k,v] of Object.entries(storage))w.localStorage.setItem(k,v);
 let session=user?{user:{id:user},access_token:`token-${user}`}:null,listener;
 w.stub={auth:{getSession:async()=>({data:{session},error:null}),onAuthStateChange(fn){listener=fn;}}};
 w.supabase={createClient:server.createClient};
 w.fetch=async url=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(root,url),'utf8'))});
 vm.runInContext('const supabaseClient=window.stub;const SUPABASE_URL="https://test.invalid";const SUPABASE_KEY="public";',dom.getInternalVMContext());
 for(const file of ['question-identity.js','mistake-training.js','mistake-training-runtime.js','components/mistake-training-page.js'])w.eval(fs.readFileSync(path.join(root,file),'utf8'));
 await until(()=>!w.document.getElementById('trainingStatus').textContent.startsWith('Loading'));
 const buttons=()=>[...w.document.querySelectorAll('#trainingContent button')];
 return {w,buttons,click(text){const button=buttons().find(b=>b.textContent===text);assert.ok(button,`button ${text}`);assert.equal(button.disabled,false);button.click();},snapshot:()=>Object.fromEntries(Array.from({length:w.localStorage.length},(_,i)=>{const k=w.localStorage.key(i);return[k,w.localStorage.getItem(k)];})),account(next){session=next?{user:{id:next},access_token:`token-${next}`}:null;listener('SIGNED_IN',session);}};
}

test('UI selects five, starts, recovers a lost answer across refresh, finalizes and isolates accounts/KROKs',async t=>{
 const server=backend();const p=await page(t,server);
 assert.equal(p.w.document.querySelectorAll('input:checked').length,5);
 const first=p.w.document.querySelector('input');first.checked=false;first.dispatchEvent(new p.w.Event('change'));
 assert.equal(p.buttons().find(b=>b.textContent==='Start training').disabled,true);
 first.checked=true;first.dispatchEvent(new p.w.Event('change'));p.click('Start training');
 await until(()=>p.w.document.querySelectorAll('.training-answer').length===5);
 server.loseNextAnswer();p.w.document.querySelectorAll('.training-answer')[0].click();
 await until(()=>p.w.document.getElementById('trainingStatus').textContent==='response lost');
 assert.ok(Object.keys(p.snapshot()).some(k=>k.startsWith('krok.mt.command')));
 const r=await page(t,server,{storage:p.snapshot()});
 await until(()=>r.buttons().some(b=>b.textContent==='Next question'));
 assert.equal(server.get('A',1).sessions.length,1);
 const answers=server.calls.filter(c=>c.args.p_action==='answer');assert.deepEqual(JSON.parse(JSON.stringify(answers[0])),JSON.parse(JSON.stringify(answers[1])));
 r.click('Next question');
 for(let i=1;i<5;i++){
  await until(()=>r.w.document.querySelector('.training-answer:not(:disabled)'));
  r.w.document.querySelector('.training-answer').click();
  await until(()=>r.buttons().some(b=>b.textContent===(i===4?'Finish session':'Next question')&&!b.disabled));
  r.click(i===4?'Finish session':'Next question');
 }
 r.click('Finalize session');await until(()=>r.w.document.getElementById('trainingStatus').textContent.includes('Session completed'));
 assert.ok(server.get('A',1).progress.every(p=>p.valid_sessions===1));
 r.account('B');assert.equal(r.w.document.getElementById('trainingContent').textContent,'');
 await until(()=>r.w.document.getElementById('trainingContent').textContent.includes('No saved questions yet'));
 assert.ok(!r.w.document.getElementById('trainingContent').textContent.includes('1 / 3 credits'));
 r.account(null);await until(()=>r.w.document.getElementById('trainingStatus').textContent.includes('Sign in'));
 const k2=await page(t,server,{krok:2});
 assert.ok([...k2.w.document.querySelectorAll('input')].every(input=>input.value.startsWith('main:krok2-')));
 k2.click('Start training');await until(()=>k2.w.document.querySelectorAll('.training-answer').length===5);
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
 p.click('Start training');
 await until(()=>p.w.document.querySelectorAll('.training-answer').length===5);
 const options=p.w.document.querySelectorAll('.training-answer');
 const question=server.banks.get(1)[0];
 assert.equal(options[3].textContent,question.answers[3]);
 options[3].click();
 await until(()=>p.w.document.querySelector('.training-feedback'));
 const request=server.calls.find(c=>c.args.p_action==='answer');
 assert.equal(request.args.p_selected_index,3);
 assert.equal('is_correct' in request.args,false);
 assert.match(p.w.document.querySelector('.training-feedback').textContent,/Incorrect/);
 assert.equal(p.w.document.querySelector('.training-wrong').textContent,question.answers[3]);
 assert.equal(p.w.document.querySelector('.training-correct').textContent,question.answers[question.correct]);
});
