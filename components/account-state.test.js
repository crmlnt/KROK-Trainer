'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');

test('My Notes sign-in and failure use the shared card while preserving title and breadcrumb',async t=>{
 for(const failure of [false,true]){
  const dom=new JSDOM(fs.readFileSync('notes/index.html','utf8'),{runScripts:'outside-only',url:'https://example.test/notes/index.html'});
  t.after(()=>dom.window.close());const w=dom.window;
  w.supabaseClient={auth:{getUser:async()=>{if(failure)throw Error('Network unavailable');return {data:{user:null},error:null};}}};
  w.console.error=()=>{};w.eval(fs.readFileSync('notes/notes.js','utf8'));
  await new Promise(resolve=>setImmediate(resolve));
  const card=w.document.getElementById('notesAuthGate');
  assert.equal(card.hidden,false);assert.ok(card.classList.contains('account-state'));
  assert.equal(w.document.querySelector('h1').textContent,'My Notes');assert.ok(w.document.getElementById('appBreadcrumb'));
  assert.equal(card.querySelector('h2').textContent,failure?'Unable to load notes':'Sign in required');
  assert.equal(card.querySelector('a').hidden,failure);
  if(!failure){assert.equal(card.querySelector('a').textContent,'Sign In');assert.equal(card.querySelector('p').textContent,'Sign in to your KROK Trainer account to view and manage your saved notes.');}
 }
});
