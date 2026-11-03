const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const rows = [
  { question_id: '1', subject: 'Physiology', user_answer: 'Right', correct_answer: 'Right', is_correct: true },
  { question_id: '2', subject: 'Physiology', user_answer: '<Wrong>', correct_answer: 'Right', is_correct: false },
  { question_id: '3', subject: 'Physiology', user_answer: null, correct_answer: 'Right', is_correct: false },
  { question_id: 'missing', subject: 'Physiology', user_answer: 'Original right', correct_answer: 'Other saved text', is_correct: true }
];

async function review(t) {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, 'exam-review.html'), 'utf8'), {
    runScripts: 'outside-only', url: 'https://example.test/history/exam-review.html?id=42'
  });
  const w = dom.window, errors = [], calls = [];
  w.addEventListener('error', e => errors.push(e.message));
  t.after(() => { w.close(); assert.deepEqual(errors, []); });
  w.scrollTo = () => {};
  const saved = JSON.parse(JSON.stringify(rows));
  const bank = rows.slice(0, 3).map(r => ({ id: r.question_id, subject: r.subject, question: `Question ${r.question_id}`, answers: ['Right', '<Wrong>'], correct: 0 }));
  w.supabaseClient = {
    auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) },
    from: table => {
      calls.push(table);
      return { select: () => ({ eq: () => ({
        single: async () => ({ data: { krok: 1, subject: 'Physiology', questions_total: 4, score: 50, correct: 2, wrong: 2 } }),
        order: async () => ({ data: saved })
      }) }) };
    }
  };
  w.fetch = async () => ({ ok: true, json: async () => bank });
  const style = w.document.createElement('style');
  style.textContent = fs.readFileSync(path.join(__dirname, 'history.css'), 'utf8');
  w.document.head.append(style);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'exam-review.js'), 'utf8'), dom.getInternalVMContext());
  await new Promise(resolve => setImmediate(resolve));
  return { w, saved, calls, cards: () => [...w.document.querySelectorAll('.review-question-card')] };
}

test('saved review distinguishes correct/wrong/unanswered and removes only identical correct duplicates', async t => {
  const h = await review(t), [correct, wrong, unanswered, inconsistent] = h.cards();
  assert.equal(correct.querySelectorAll('.review-answer').length, 1);
  assert.match(correct.querySelector('.review-correct-answer strong').textContent, /Your answer · Correct/);
  assert.ok(wrong.querySelector('.review-user-answer.review-wrong-answer'));
  assert.ok(wrong.querySelector('.review-correct-answer'));
  assert.equal(wrong.querySelector('.review-user-answer span').textContent, '<Wrong>');
  assert.equal(wrong.querySelector('.review-user-answer span').children.length, 0, 'saved text stays escaped');
  assert.ok(unanswered.classList.contains('review-unanswered'));
  assert.equal(unanswered.querySelector('.review-result').textContent, 'Not answered');
  assert.equal(unanswered.querySelector('.review-user-answer').classList.contains('review-wrong-answer'), false);
  assert.equal(inconsistent.querySelectorAll('.review-answer').length, 2, 'distinct historical answer text is preserved');
  assert.match(inconsistent.textContent, /Original right/);
  assert.match(inconsistent.textContent, /Other saved text/);
  assert.deepEqual(h.saved, rows);
  assert.deepEqual(h.calls, ['exam_sessions', 'exam_session_questions']);
});

test('feedback colors remain distinct in light and dark themes', async t => {
  const h = await review(t);
  for (const dark of [false, true]) {
    h.w.document.body.classList.toggle('dark-mode', dark);
    const [, wrong, unanswered] = h.cards();
    const bg = el => h.w.getComputedStyle(el).backgroundColor;
    assert.equal(bg(wrong.querySelector('.review-wrong-answer')), dark ? 'rgb(53, 25, 27)' : 'rgb(254, 242, 242)');
    assert.equal(bg(wrong.querySelector('.review-correct-answer')), dark ? 'rgb(23, 49, 31)' : 'rgb(240, 253, 244)');
    assert.equal(bg(unanswered.querySelector('.review-user-answer')), dark ? 'rgb(32, 36, 41)' : 'rgb(248, 250, 252)');
  }
});

test('mistakes filter and retry retain saved results and summary score', async t => {
  const h = await review(t);
  h.w.document.getElementById('showWrongBtn').click();
  assert.equal(h.cards().length, 2);
  assert.equal(h.w.document.querySelector('#reviewSummary strong').textContent, '50%');
  h.w.document.getElementById('retryWrongBtn').click();
  [...h.w.document.querySelectorAll('.retry-answer-btn')].find(b => b.textContent === 'Right').click();
  assert.equal(h.w.document.getElementById('retryFeedback').textContent, 'Correct!');
  h.w.document.getElementById('backToReviewBtn').click();
  assert.equal(h.w.document.getElementById('reviewContent').hidden, false);
  assert.deepEqual(h.saved, rows);
  assert.equal(h.w.document.querySelector('#reviewSummary strong').textContent, '50%');
});
