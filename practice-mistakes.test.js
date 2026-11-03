const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const vm = require('node:vm');

const html = fs.readFileSync('practice.html', 'utf8');
const engine = fs.readFileSync('app.js', 'utf8');
const persistence = fs.readFileSync('active-session.js', 'utf8');
const shell = fs.readFileSync('components/practice-shell.js', 'utf8');
const archiveRecord = (id = 'old') => ({ questionId: id, subject: 'Physiology', question: `Archived ${id}`, answers: ['Right', 'Wrong'], correct: 0, userAnswer: 'Wrong' });
const tick = () => new Promise(resolve => setImmediate(resolve));

async function createHarness(t, { krok = 1, storage = {}, exam = false } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: `https://example.test/practice.html?exam=krok${krok}${exam ? '&mode=exam&questions=2' : ''}` });
  const w = dom.window;
  const runtimeErrors = [];
  w.addEventListener('error', event => runtimeErrors.push(event.error?.message || event.message));
  t.after(() => { w.close(); assert.deepEqual(runtimeErrors, [], 'no uncaught UI handler errors'); });
  w.document.body.classList.toggle('practice-session', !exam);
  for (const [key, value] of Object.entries(storage)) w.localStorage.setItem(key, value);
  const bank = [1, 2].map(id => ({ id: krok === 2 ? `krok2-000${id}` : String(id), subject: 'Physiology', question: `Question ${id}`, answers: ['Right', 'Wrong'], correct: 0 }));
  w.fetch = async url => ({ ok: true, json: async () => [], text: async () => JSON.stringify(bank) });
  w.console = { log() {}, warn() {}, error() {} };
  w.alert = () => {};
  w.confirm = () => true;
  w.scrollTo = () => {};
  let clipboard = '';
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: text => { clipboard = text; return Promise.resolve(); } } });
  vm.runInContext(persistence + '\n' + engine + `
    window.engine = {
      state: () => JSON.parse(JSON.stringify({score, correctAnswers, wrongAnswers, sessionErrors, errors, currentQuestionIndex, reviewMode, answered, examMode, examSessionLog, questions})),
      restoreActiveSession, exportErrorLog, updateErrorLog, clearErrorLog,
      save: () => ActiveSession.save()
    };
  `, dom.getInternalVMContext());
  vm.runInContext(shell, dom.getInternalVMContext());
  await tick();
  const click = id => w.document.getElementById(id).click();
  const answer = async (correct) => {
    const button = [...w.document.querySelectorAll('.answer-btn')].find(b => b.textContent === (correct ? 'Right' : 'Wrong'));
    assert.ok(button, 'answer is rendered');
    button.click();
    click('confirmAnswerBtn');
    await tick();
  };
  return { w, click, answer, state: () => JSON.parse(JSON.stringify(w.engine.state())), raw: () => w.localStorage.getItem('errors'), clipboard: () => clipboard,
    stats: () => w.localStorage.getItem(`krok${krok}_subjectStats`),
    saved: () => w.localStorage.getItem(`krok${krok}_active_${exam ? 'exam' : 'practice'}`) };
}

for (const krok of [1, 2]) {
  test(`KROK ${krok}: sessions accumulate, reload reviews both, review answers/exit preserve state`, async t => {
    const h = await createHarness(t, { krok });
    assert.equal(h.raw(), null, 'startup does not create an archive');
    h.click('startPracticeBtn');
    await h.answer(false);
    h.click('next-btn');
    await h.answer(true);
    h.click('next-btn');
    assert.equal(h.w.document.getElementById('practiceCompletionUI').hidden, false);
    h.click('backToSetupBtn');
    h.click('startPracticeBtn');
    await h.answer(false);
    assert.equal(JSON.parse(h.raw()).length, 2);
    assert.equal(h.state().sessionErrors.length, 1);
    const raw = h.raw();
    const r = await createHarness(t, { krok, storage: { errors: raw } });
    assert.equal(r.raw(), raw, 'reload does not normalize/rewrite records');
    r.click('startPracticeBtn');
    await r.answer(true);
    const before = r.state(), stats = r.stats(), saved = r.saved();
    r.click('review-btn');
    assert.equal(r.state().questions.length, 2);
    assert.ok(r.state().questions.every(q => q.id));
    await r.answer(false);
    r.click('next-btn');
    await r.answer(true);
    r.click('next-btn');
    assert.match(r.w.document.getElementById('feedback').textContent, /Review complete/);
    assert.equal(r.saved(), saved, 'review completion never clears the original active session');
    r.click('backToPracticeBtn');
    const after = r.state();
    for (const key of ['score', 'correctAnswers', 'wrongAnswers', 'sessionErrors', 'errors', 'questions', 'currentQuestionIndex', 'answered']) assert.deepEqual(after[key], before[key], key);
    assert.equal(r.stats(), stats);
    assert.equal(r.raw(), raw);
    assert.equal(r.saved(), saved);
    // A previously confirmed answer stays locked after returning.
    await r.answer(false);
    assert.equal(r.state().wrongAnswers, before.wrongAnswers);
  });

  test(`KROK ${krok}: completion review is session-only and cannot replace archive`, async t => {
    const old = JSON.stringify([archiveRecord()]);
    const h = await createHarness(t, { krok, storage: { errors: old } });
    h.click('startPracticeBtn');
    await h.answer(false);
    h.click('next-btn');
    await h.answer(true);
    h.click('next-btn');
    assert.equal(h.w.document.getElementById('practiceCompletionUI').hidden, false);
    const before = h.state(), raw = h.raw(), stats = h.stats();
    h.click('reviewSessionMistakesBtn');
    assert.equal(h.state().questions.length, 1);
    assert.notEqual(h.state().questions[0].question, 'Archived old');
    assert.equal(h.state().questions[0].id, before.sessionErrors[0].questionId);
    await h.answer(false);
    assert.equal(h.raw(), raw);
    h.click('next-btn');
    h.click('backToPracticeBtn');
    assert.equal(h.w.document.getElementById('practiceCompletionUI').hidden, false);
    for (const key of ['score', 'correctAnswers', 'wrongAnswers', 'sessionErrors', 'errors', 'currentQuestionIndex']) assert.deepEqual(h.state()[key], before[key], key);
    assert.equal(h.raw(), raw);
    assert.equal(h.stats(), stats);
    h.click('backToSetupBtn');
    h.click('startPracticeBtn');
    h.click('review-btn');
    assert.equal(h.state().questions.length, 2, 'cross-session review remains available');
  });

  test(`KROK ${krok}: session save/resume retains mistakes and review does not persist itself`, async t => {
    const h = await createHarness(t, { krok });
    h.click('startPracticeBtn');
    await h.answer(false);
    const saved = h.saved(), raw = h.raw(), stats = h.stats();
    const r = await createHarness(t, { krok, storage: { [`krok${krok}_active_practice`]: saved, errors: raw, [`krok${krok}_subjectStats`]: stats } });
    r.click('resumePracticeBtn');
    assert.deepEqual(r.state().sessionErrors, h.state().sessionErrors);
    assert.equal(r.state().wrongAnswers, 1);
    r.click('review-btn');
    await r.answer(false);
    r.w.engine.save();
    assert.equal(r.saved(), saved);
    r.click('backToPracticeBtn');
    assert.equal(r.state().answered, true);
    assert.equal(r.raw(), raw);
    assert.equal(r.stats(), stats);
  });
}

test('both historical record formats render/export/review without rewriting original data', async t => {
  const records = [archiveRecord('numeric'), { id: 'text', question: 'Text format', subject: 'Physiology', answers: ['Right', 'Wrong'], yourAnswer: 'Wrong', correctAnswer: 'Right' }, { ...archiveRecord('zero'), questionId: 0, userAnswer: null }];
  const raw = JSON.stringify(records, null, 2);
  const h = await createHarness(t, { storage: { errors: raw } });
  const display = h.w.document.getElementById('error-log').textContent;
  assert.doesNotMatch(display, /undefined/);
  assert.match(display, /Your answer: Wrong \| Correct: Right/);
  h.w.engine.exportErrorLog();
  assert.doesNotMatch(h.clipboard(), /undefined/);
  assert.match(h.clipboard(), /Text format\tWrong\tRight/);
  assert.match(h.clipboard(), /Not recorded/);
  h.click('startPracticeBtn');
  h.click('review-btn');
  assert.deepEqual(h.state().questions.map(q => [q.id, q.correct]), [['numeric', 0], ['text', 0], [0, 0]]);
  assert.equal(h.raw(), raw);
});

for (const raw of [null, '[]', ' { broken', 'null', '{}', '42', '"text"', '[null]', '[{}]']) {
  test(`storage loading is usable and non-destructive: ${raw === null ? "missing key" : JSON.stringify(raw)}`, async t => {
    const h = await createHarness(t, { storage: raw === null ? {} : { errors: raw } });
    assert.equal(h.raw(), raw);
    h.click('startPracticeBtn');
    await h.answer(false);
    assert.equal(h.state().sessionErrors.length, 1);
    if (raw === null || raw === '[]') assert.equal(JSON.parse(h.raw()).length, 1);
    else assert.equal(h.raw(), raw, 'invalid stored bytes must survive new mistakes');
    h.w.engine.updateErrorLog();
    h.w.engine.exportErrorLog();
    assert.doesNotMatch(h.clipboard(), /undefined/);
  });
}

test('returning from review preserves a pending selection and permits one confirmation', async t => {
  const h = await createHarness(t, { storage: { errors: JSON.stringify([archiveRecord()]) } });
  h.click('startPracticeBtn');
  [...h.w.document.querySelectorAll('.answer-btn')].find(b => b.textContent === 'Right').click();
  h.click('review-btn');
  await h.answer(false);
  h.click('backToPracticeBtn');
  h.click('confirmAnswerBtn');
  await tick();
  assert.equal(h.state().score, 1);
  assert.equal(h.state().wrongAnswers, 0);
});

test('clear remains explicit and cancellation preserves malformed stored data', async t => {
  const h = await createHarness(t, { storage: { errors: '{broken' } });
  h.w.confirm = () => false;
  h.click('clear-errors-btn');
  assert.equal(h.raw(), '{broken');
  h.w.confirm = () => true;
  h.click('clear-errors-btn');
  assert.equal(h.raw(), null);
  h.click('startPracticeBtn');
  await h.answer(false);
  assert.equal(JSON.parse(h.raw()).length, 1);
});

for (const krok of [1, 2]) {
  test(`KROK ${krok}: Exam answers retain scoring/session log and never enter Practice archives`, async t => {
    const raw = JSON.stringify([archiveRecord()]);
    const h = await createHarness(t, { krok, exam: true, storage: { errors: raw } });
    await h.answer(false);
    h.click('next-btn');
    await h.answer(true);
    const state = h.state();
    assert.equal(state.examMode, true);
    assert.equal(state.score, 1);
    assert.equal(state.correctAnswers, 1);
    assert.equal(state.wrongAnswers, 1);
    assert.deepEqual(state.examSessionLog.map(q => q.result), ['Wrong', 'Correct']);
    assert.equal(state.sessionErrors.length, 0);
    assert.equal(h.raw(), raw);
    assert.equal(JSON.parse(h.saved()).examSessionLog.length, 2);
    assert.deepEqual(JSON.parse(h.stats()), { Physiology: { correct: 1, wrong: 1 } });
  });
}


test('normal appends preserve historical records and reset never clears the archive', async t => {
  const original = { ...archiveRecord(), extraMetadata: { keep: true } };
  const h = await createHarness(t, { storage: { errors: JSON.stringify([original]) } });
  h.click('startPracticeBtn');
  await h.answer(false);
  assert.deepEqual(JSON.parse(h.raw())[0], original);
  const raw = h.raw();
  h.click('startPracticeBtn');
  assert.equal(h.raw(), raw);
  assert.equal(h.state().sessionErrors.length, 0);
});

test('answer indices are integers, never coerced from text; correctAnswer provides a text fallback', async t => {
  const records = [
    { ...archiveRecord('fallback'), correct: '0', correctAnswer: 'Right' },
    { ...archiveRecord('invalid-index'), correct: '0' }
  ];
  const raw = JSON.stringify(records);
  const h = await createHarness(t, { storage: { errors: raw } });
  h.click('startPracticeBtn');
  h.click('review-btn');
  assert.deepEqual(h.state().questions.map(q => [q.id, q.correct]), [['fallback', 0]]);
  assert.equal(h.raw(), raw);
});


test('malformed archive introduced after page load is not overwritten by a new mistake', async t => {
  const h = await createHarness(t, { storage: { errors: JSON.stringify([archiveRecord()]) } });
  h.click('startPracticeBtn');
  h.w.localStorage.setItem('errors', '{changed elsewhere');
  await h.answer(false);
  assert.equal(h.raw(), '{changed elsewhere');
  assert.equal(h.state().sessionErrors.length, 1);
});
