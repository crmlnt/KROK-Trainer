'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { catalogSQL } = require('./catalog');
const { validateBuild } = require('../question-identity/build-gate');
const root = path.resolve(__dirname, '../..');
const user1 = '00000000-0000-0000-0000-000000000001';
const user2 = '00000000-0000-0000-0000-000000000002';
const sid = n => `10000000-0000-0000-0000-${String(n).padStart(12,'0')}`;

test('build gates accept only the published baseline and preserve intentional duplicates', () => {
 for (const [krok,file] of [[1,'questions.json'],[2,'krok2/questions-krok2.json']]) {
  const bytes=fs.readFileSync(path.join(root,file));
  assert.ok(validateBuild(krok,bytes).identicalContentGroups>0);
  const questions=JSON.parse(bytes);
  [questions[0].id,questions[1].id]=[questions[1].id,questions[0].id];
  assert.throws(()=>validateBuild(krok,Buffer.from(JSON.stringify(questions))), /checksum/);
 }
 for (const file of ['scripts/build/krok1.js','scripts/build/krok2.js']) {
  const source=fs.readFileSync(path.join(root,file),'utf8');
  assert.ok(source.indexOf('validateBuild(')<source.indexOf('fs.writeFileSync('));
 }
});

test('SQL engine: retries, ownership, grading, mastery, incomplete sessions and finalization', async () => {
 const db=new PGlite();
 try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
   create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   grant usage on schema auth to authenticated,anon;
   grant execute on function auth.uid() to authenticated,anon;
   insert into auth.users values ('${user1}'),('${user2}');`);
  await db.exec(fs.readFileSync(path.join(root,'docs/migrations/20261106_mistake_training.sql'),'utf8'));
  await db.exec(catalogSQL());
  assert.equal((await db.query('select count(*)::int as n from mistake_private.catalog')).rows[0].n,5299);
  const ids=['main:1','main:2','main:3','main:4','main:5'];
  const keys=(await db.query('select question_id, correct_index from mistake_private.catalog where krok=1 and question_id=any($1::text[])',[ids])).rows;
  const correct=new Map(keys.map(x=>[x.question_id,x.correct_index]));
  const login=async user=>{await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);await db.exec('set role authenticated');};
  const rpc=async(action,n,questions=null,q=null,index=null,krok=1)=> (await db.query('select public.mistake_training($1,$2,$3,$4,$5,$6) as result',[action,krok,sid(n),questions,q,index])).rows[0].result;
  const progress=async()=> (await db.query('select question_id,valid_sessions from public.mistake_training_progress order by question_id')).rows;
  const complete=async n=>{await rpc('start',n,ids);for(const q of ids)await rpc('answer',n,null,q,correct.get(q));await rpc('finalize',n);};
  await login(user1);
  await assert.rejects(rpc('start',1,ids.slice(0,4)),/invalid_questions/);
  await assert.rejects(rpc('start',1,[...ids.slice(0,4),'paper:2015:8']),/invalid_questions/);
  await assert.rejects(rpc('start',1,[...ids.slice(0,4),ids[0]]),/invalid_questions/);
  await assert.rejects(rpc('start',1,ids,null,null,2),/invalid_questions/);
  const started=await rpc('start',1,ids);
  const starts=await Promise.all([rpc('start',1,ids),rpc('start',1,ids)]);
  assert.deepEqual(starts,[started,started]);
  await assert.rejects(rpc('start',1,[...ids].reverse()),/idempotency_conflict/);
  await assert.rejects(rpc('start',2,ids),/active_session_exists/);
  assert.deepEqual(await rpc('resume',1),started);
  await assert.rejects(rpc('finalize',1),/session_incomplete/);
  assert.ok((await progress()).every(p=>p.valid_sessions===0));
  await rpc('answer',1,null,ids[0],correct.get(ids[0]));
  await rpc('answer',1,null,ids[0],correct.get(ids[0]));
  await assert.rejects(rpc('answer',1,null,ids[0],(correct.get(ids[0])+1)%5),/idempotency_conflict/);
  await assert.rejects(rpc('answer',1,null,ids[1],99),/invalid_answer/);
  await login(user2);
  assert.deepEqual(await progress(),[]);
  await assert.rejects(rpc('resume',1),/session_not_found/);
  await assert.rejects(rpc('answer',1,null,ids[0],0),/session_not_found/);
  await assert.rejects(rpc('finalize',1),/session_not_found/);
  assert.equal((await db.query('select * from public.mistake_training_sessions')).rows.length,0);
  await assert.rejects(db.query('select * from public.mistake_training_answers'),/permission denied/);
  await assert.rejects(db.query('select * from mistake_private.catalog'),/permission denied/);
  await assert.rejects(db.query('update public.mistake_training_progress set valid_sessions=3'),/permission denied/);
  await login(user1);
  for(const q of ids.slice(1))await rpc('answer',1,null,q,correct.get(q));
  const finalized=await rpc('finalize',1);
  assert.equal(finalized.status,'completed');
  const finals=await Promise.all([rpc('finalize',1),rpc('finalize',1)]);
  assert.deepEqual(finals,[finalized,finalized]);
  await rpc('answer',1,null,ids[0],correct.get(ids[0])); // response lost after completion
  assert.ok((await progress()).every(p=>p.valid_sessions===1));
  await complete(2); await complete(3);
  assert.ok((await progress()).every(p=>p.valid_sessions===3));
  await rpc('start',4,ids);
  const wrong=(correct.get(ids[0])+1)%5;
  await rpc('answer',4,null,ids[0],wrong);
  assert.equal((await progress()).find(p=>p.question_id===ids[0]).valid_sessions,0);
  await assert.rejects(rpc('finalize',4),/session_incomplete/);
  await rpc('answer',4,null,ids[0],wrong);
  for(const q of ids.slice(1))await rpc('answer',4,null,q,correct.get(q));
  await rpc('finalize',4);await rpc('finalize',4);
  assert.equal((await progress()).find(p=>p.question_id===ids[0]).valid_sessions,0);
  await complete(5);
  // An old retry must not reset progress accumulated after that session.
  await rpc('answer',4,null,ids[0],wrong);
  assert.equal((await progress()).find(p=>p.question_id===ids[0]).valid_sessions,1);
  const ids2=[1,2,3,4,5].map(n=>`main:krok2-${String(n).padStart(4,'0')}`);
  await rpc('start',1,ids2,null,null,2);
  assert.equal((await db.query('select count(*)::int as n from public.mistake_training_sessions where krok=2')).rows[0].n,1);
  assert.ok((await progress()).filter(p=>p.question_id.startsWith('main:krok2')).every(p=>p.valid_sessions===0));
  await login('');
  await assert.rejects(rpc('resume',1),/authentication_required/);
  await db.exec('reset role; set role anon');
  await assert.rejects(rpc('resume',1),/permission denied/);
 } finally { await db.close(); }
});

test('client forwards stable retry identifiers and propagates RPC failures', async () => {
 const calls=[];
 const client=require('../../mistake-training').createClient({rpc:async(name,args)=>{calls.push({name,args});return {data:{status:'active'},error:null};}});
 await client.start(1,sid(1),['main:1']);
 await client.start(1,sid(1),['main:1']);
 assert.deepEqual(calls[0],calls[1]);
 await client.resume(1,sid(1));
 await client.answer(1,sid(1),'main:1',0);
 await client.finalize(1,sid(1));
 assert.deepEqual(calls.map(c=>c.args.p_action),['start','start','resume','answer','finalize']);
 assert.equal(calls[3].args.p_selected_index,0);
 const error=new Error('network failure');
 const broken=require('../../mistake-training').createClient({rpc:async()=>({data:null,error})});
 await assert.rejects(broken.finalize(1,sid(1)),e=>e===error);
});
