'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync, spawnSync } = require('node:child_process');
const identity = require('./question-identity.js');
const { BANKS, BASELINE_COMMIT, sha256, fingerprints, createManifest, validateManifest, validateTransition, verifyPublished } = require('./scripts/question-identity/manifest.js');
const root = __dirname;
const clone = value => JSON.parse(JSON.stringify(value));
const bankBytes = config => fs.readFileSync(path.join(root, config.path));
const manifests = BANKS.map(c => JSON.parse(fs.readFileSync(path.join(root, 'data/question-identity', `krok${c.krok}-main.manifest.json`), 'utf8')));
const banks = new Map(BANKS.map(c => [c.krok, JSON.parse(bankBytes(c))]));

function fixture(krok = 1) {
  const q = { id: krok === 1 ? 1 : 'krok2-0001', subject: 'Physiology', question: 'Question', answers: ['Right', 'Wrong'], correct: 0 };
  const bytes = Buffer.from(JSON.stringify([q]));
  const config = { krok, path: krok === 1 ? 'questions.json' : 'krok2/questions-krok2.json', count: 1, sha256: sha256(bytes) };
  return { q, bytes, manifest: createManifest(config, bytes) };
}
const plan = (before, after, action) => ({ legacyId: after.legacyId, action, reason: 'Explicit test review', before: before ? clone(before) : null, after: clone(after) });

test('both manifests exactly reproduce committed/published baseline and leave bank bytes intact', () => {
  for (const [i, config] of BANKS.entries()) {
    const bytes = bankBytes(config);
    assert.equal(sha256(bytes), config.sha256);
    assert.deepEqual(manifests[i], createManifest(config, bytes));
    assert.equal(execFileSync('git', ['show', `${BASELINE_COMMIT}:${config.path}`], { cwd: root, maxBuffer: 10 * 1024 * 1024 }).equals(bytes), true);
    const summary = validateManifest(manifests[i], bytes);
    assert.equal(summary.questions, config.count);
    assert.ok(summary.identicalContentGroups > 0, 'identical content is informational, not an error');
  }
});

test('all 5299 published IDs round-trip without changing types, Notes keys or History IDs', () => {
  const resolver = identity.createResolver(manifests);
  for (const [krok, bank] of banks) for (const q of bank) {
    const original = JSON.stringify(q);
    const result = resolver.resolveIdentity({ krok, format: 'bank', id: q.id });
    assert.equal(result.status, 'resolved');
    assert.equal(resolver.toBankId(result.identity), q.id);
    const note = resolver.toNoteKey(result.identity);
    assert.equal(note, krok === 1 ? `krok1-${q.id}` : q.id);
    for (const [format, id] of [['note', note], ['history', String(q.id)], ['canonical', result.identity.questionId]]) {
      assert.deepEqual(resolver.resolveIdentity({ krok, format, id }).identity, result.identity);
    }
    assert.equal(JSON.stringify(q), original);
  }
});

test('lookup preserves individual records and subject classifications', () => {
  const a = fixture(), b = { ...a.q, id: 2, subject: 'Biochemistry' };
  const bytes = Buffer.from(JSON.stringify([a.q, b]));
  const manifest = createManifest({ krok: 1, path: 'questions.json', count: 2, sha256: sha256(bytes) }, bytes);
  assert.equal(validateManifest(manifest, bytes).identicalContentGroups, 1);
  const resolver = identity.createResolver([manifest]);
  const first = resolver.lookupQuestion({ krok: 1, questionId: 'main:1' }, [a.q, b]);
  const second = resolver.lookupQuestion({ krok: 1, questionId: 'main:2' }, [a.q, b]);
  assert.equal(first.question, a.q);
  assert.equal(second.question, b);
  assert.notEqual(first.identity.questionId, second.identity.questionId);
  assert.equal(second.question.subject, 'Biochemistry');
  assert.equal(resolver.resolveLegacyMistake({ question: a.q.question, answers: a.q.answers, correct: 0 }, new Map([[1, [a.q, b]]])).status, 'ambiguous');
});

test('duplicate IDs are blocking even when content and subjects differ', () => {
  const { q, manifest } = fixture();
  const duplicate = Buffer.from(JSON.stringify([q, { ...q, subject: 'Biochemistry', question: 'Other' }]));
  assert.throws(() => validateManifest(manifest, duplicate), /Duplicate question ID/);
  manifest.entries.push(clone(manifest.entries[0]));
  assert.throws(() => identity.createResolver([manifest]), /Duplicate ID/);
});

test('explicit context, safe integers and exact public formats prevent accidental cross-KROK mappings', () => {
  const r = identity.createResolver(manifests);
  for (const input of [
    { format: 'bank', id: 1 }, { krok: '1', format: 'bank', id: 1 },
    { krok: 1, format: 'bank', id: '1' }, { krok: 2, format: 'bank', id: 1 },
    { krok: 1, format: 'history', id: 'krok2-0001' }, { krok: 2, format: 'note', id: 'krok1-1' },
    { krok: 1, format: 'bank', id: 1.5 }, { krok: 1, format: 'bank', id: Number.MAX_SAFE_INTEGER + 1 },
    { krok: 2, format: 'bank', id: 'krok2-0000' }, { krok: 2, format: 'bank', id: 'krok2-00001' },
    { krok: 1, format: 'history', id: '001' }, { krok: 1, format: 'history', id: '1e0' },
    { krok: 1, format: 'canonical', id: 'main:999999' }
  ]) assert.equal(r.resolveIdentity(input).status, 'unresolved');
});

test('deep links retain current normalization without applying it to History', () => {
  const r = identity.createResolver(manifests);
  assert.equal(r.resolveIdentity({ krok: 1, format: 'deepLink', id: 'KROK1-0001' }).legacyId, 1);
  assert.equal(r.resolveIdentity({ krok: 2, format: 'deepLink', id: '1' }).legacyId, 'krok2-0001');
  assert.equal(r.resolveIdentity({ krok: 2, format: 'deepLink', id: 'KROK2-0001' }).legacyId, 'krok2-0001');
  assert.equal(r.resolveIdentity({ krok: 2, format: 'history', id: '1' }).status, 'unresolved');
});

test('Past Papers are excluded and never reinterpreted as ordinary main-bank IDs', () => {
  const r = identity.createResolver(manifests);
  for (const input of [
    { krok: 1, namespace: 'paper', format: 'bank', id: 1 },
    { krok: 1, format: 'history', id: '2015-1' },
    { krok: 1, format: 'note', id: 'krok1-2015-1' },
    { krok: 1, format: 'canonical', id: 'paper:2015:1' },
    { krok: 1, format: 'canonical', id: 'main:2015-1' }
  ]) assert.equal(r.resolveIdentity(input).status, 'excluded');
});

test('historical mistakes support both answer formats, missing IDs and mismatch rejection without mutation', () => {
  const a = fixture(), r = identity.createResolver([a.manifest]), bank = new Map([[1, [a.q]]]);
  const records = [
    { questionId: 1, question: a.q.question, answers: a.q.answers, correct: 0, userAnswer: 'Wrong' },
    { id: '1', question: a.q.question, answers: a.q.answers, correctAnswer: 'Right', yourAnswer: 'Wrong' },
    { question: a.q.question, answers: a.q.answers, correctAnswer: 'Right' }
  ];
  for (const record of records) {
    const before = JSON.stringify(record);
    assert.equal(r.resolveLegacyMistake(record, bank).legacyId, 1);
    assert.equal(JSON.stringify(record), before);
  }
  assert.equal(r.resolveLegacyMistake({ ...records[0], question: 'Different published question' }, bank).status, 'unresolved');
  for (const record of [null, [], {}, { question: 'Question', answers: [] }, { krok: 3, questionId: 1 }]) {
    assert.equal(r.resolveLegacyMistake(record, bank).status, 'unresolved');
  }
  assert.equal(r.resolveLegacyMistake({ questionId: '2015-1' }, bank).status, 'excluded');
});

test('legacy Past Paper subject excludes a matching main snapshot even without an ID', () => {
  const r = identity.createResolver(manifests);
  const paper = JSON.parse(fs.readFileSync(path.join(root, 'past-papers/data/2015.json'), 'utf8'));
  const q = paper.questions.find(q => q.number === 8);
  assert.ok(q);
  const snapshot = { question: q.question, answers: q.answers, correct: q.correct };
  assert.deepEqual(r.resolveLegacyMistake(snapshot, banks).identity, { krok: 1, questionId: 'main:891' });
  for (const grading of [{ correct: q.correct }, { correctAnswer: q.answers[q.correct] }]) {
    for (const ids of [{}, { id: 891 }, { questionId: '891' }]) {
      const record = { question: q.question, answers: q.answers, ...grading, ...ids, subject: 'Past Paper 2015' };
      const before = clone(record);
      assert.deepEqual(r.resolveLegacyMistake(record, banks), { status: 'excluded', reason: 'non_main_namespace' });
      assert.deepEqual(record, before);
    }
  }
  const main = banks.get(1).find(q => q.id === 891);
  assert.equal(r.resolveLegacyMistake({ ...snapshot, subject: main.subject }, banks).status, 'resolved');
});

test('ambiguous snapshots across KROK contexts are never assigned automatically', () => {
  const a = fixture(1), b = fixture(2), r = identity.createResolver([a.manifest, b.manifest]);
  const bank = new Map([[1, [a.q]], [2, [b.q]]]);
  const record = { question: 'Question', answers: ['Right', 'Wrong'], correct: 0 };
  assert.equal(r.resolveLegacyMistake(record, bank).status, 'ambiguous');
  assert.equal(r.resolveLegacyMistake({ ...record, krok: 2 }, bank).identity.krok, 2);
});

test('retired records preserve identity and cannot redirect lookup to an active duplicate', () => {
  const { manifest, q } = fixture();
  manifest.entries[0].status = 'retired';
  const r = identity.createResolver([manifest]);
  assert.equal(r.resolveIdentity({ krok: 1, format: 'bank', id: 1 }).status, 'retired');
  assert.equal(r.toBankId({ krok: 1, questionId: 'main:1' }), 1);
  assert.equal(r.lookupQuestion({ krok: 1, questionId: 'main:1' }, [q]).question, null);
});

test('only explicit one-hop source aliases resolve; public formats cannot be redirected', () => {
  const { manifest } = fixture();
  manifest.aliases = [{ format: 'source', value: 'verified-document-item', targetLegacyId: 1 }];
  const r = identity.createResolver([manifest]);
  assert.equal(r.resolveIdentity({ krok: 1, format: 'source', id: 'verified-document-item' }).legacyId, 1);
  assert.equal(r.resolveIdentity({ krok: 1, format: 'history', id: 'verified-document-item' }).status, 'unresolved');
  const bad = clone(manifest); bad.aliases.push(clone(bad.aliases[0]));
  assert.throws(() => identity.createResolver([bad]), /ambiguous/);
  bad.aliases = [{ format: 'source', value: 'a', targetLegacyId: 'b' }, { format: 'source', value: 'b', targetLegacyId: 'a' }];
  assert.throws(() => identity.createResolver([bad]), /Invalid/);
  bad.aliases = [{ format: 'canonical', value: 'main:2', targetLegacyId: 1 }];
  assert.throws(() => identity.createResolver([bad]), /Invalid/);
});

test('lookup rejects duplicate bank IDs and unavailable content instead of returning the first match', () => {
  const { manifest, q } = fixture(), r = identity.createResolver([manifest]);
  assert.equal(r.lookupQuestion({ krok: 1, questionId: 'main:1' }, [q, clone(q)]).status, 'ambiguous');
  assert.equal(r.lookupQuestion({ krok: 1, questionId: 'main:1' }, []).status, 'unresolved');
});

test('fingerprints are deterministic and distinguish ordered grading from metadata', () => {
  const { q } = fixture();
  assert.deepEqual(fingerprints(q), fingerprints(clone(q)));
  assert.deepEqual(fingerprints(q), fingerprints({ ...q, id: 2, subject: 'Other subject' }));
  assert.notEqual(fingerprints(q).contentSha256, fingerprints({ ...q, question: 'question' }).contentSha256);
  assert.equal(fingerprints(q).gradingSha256, fingerprints({ ...q, question: 'Edited' }).gradingSha256);
  assert.notEqual(fingerprints(q).gradingSha256, fingerprints({ ...q, answers: ['Wrong', 'Right'], correct: 1 }).gradingSha256);
});

test('bootstrap assignment is independent of source array order', () => {
  const { q } = fixture();
  const a = Buffer.from(JSON.stringify([q, { ...q, id: 2 }])), b = Buffer.from(JSON.stringify([{ ...q, id: 2 }, q]));
  const build = bytes => createManifest({ krok: 1, path: 'questions.json', count: 2, sha256: sha256(bytes) }, bytes);
  assert.deepEqual(build(a).entries, build(b).entries);
});

test('bank drift, content reassignment, invalid grading and missing records are blocking', () => {
  const { manifest, q } = fixture();
  assert.throws(() => validateManifest(manifest, Buffer.from(JSON.stringify([{ ...q, question: 'Replacement' }]))), /checksum/);
  const bytes = Buffer.from(JSON.stringify([{ ...q, correct: 1 }]));
  const altered = clone(manifest); altered.currentBankSha256 = sha256(bytes);
  assert.throws(() => validateManifest(altered, bytes), /drift/);
  assert.throws(() => validateManifest(manifest, Buffer.from(JSON.stringify([{ ...q, correct: 0.5 }]))), /grading/);
  altered.currentBankSha256 = sha256(Buffer.from('[]'));
  assert.throws(() => validateManifest(altered, Buffer.from('[]')), /Missing active/);
});

test('changing bank and manifest together still requires an independent exact approval', () => {
  const { manifest, q } = fixture();
  const bytes = Buffer.from(JSON.stringify([{ ...q, question: 'Explicitly reviewed correction' }]));
  const next = clone(manifest); next.manifestRevision++; next.currentBankSha256 = sha256(bytes);
  Object.assign(next.entries[0], fingerprints({ ...q, question: 'Explicitly reviewed correction' }), { revision: 2 });
  validateManifest(next, bytes);
  assert.throws(() => validateTransition(manifest, next), /approval/);
  const approval = plan(manifest.entries[0], next.entries[0], 'edit');
  validateTransition(manifest, next, [approval]);
  approval.before.contentSha256 = '0'.repeat(64);
  assert.throws(() => validateTransition(manifest, next, [approval]), /approval/);
});

test('new IDs require review, start beyond the high-water mark and cannot lower the allocator', () => {
  const { manifest } = fixture();
  const next = clone(manifest); next.manifestRevision++; next.nextOrdinal = 3;
  const added = { ...next.entries[0], legacyId: 2 }; next.entries.push(added);
  assert.throws(() => validateTransition(manifest, next), /approval/);
  validateTransition(manifest, next, [plan(null, added, 'add')]);
  next.nextOrdinal = 2;
  assert.throws(() => validateTransition(manifest, next, [plan(null, added, 'add')]), /Allocator/);
});

test('retirement/reactivation is reviewed, tombstones cannot disappear or be overwritten', () => {
  const { manifest } = fixture();
  const retired = clone(manifest); retired.manifestRevision++; retired.entries[0].status = 'retired';
  validateTransition(manifest, retired, [plan(manifest.entries[0], retired.entries[0], 'retire')]);
  const missing = clone(retired); missing.manifestRevision++; missing.entries = [];
  assert.throws(() => validateTransition(retired, missing), /tombstone/);
  const replacement = clone(retired); replacement.manifestRevision++; replacement.entries[0].contentSha256 = '0'.repeat(64); replacement.entries[0].revision++;
  assert.throws(() => validateTransition(retired, replacement), /Retiring|Retired/);
  const active = clone(retired); active.manifestRevision++; active.entries[0].status = 'active';
  assert.throws(() => validateTransition(retired, active), /approval/);
  validateTransition(retired, active, [plan(retired.entries[0], active.entries[0], 'reactivate')]);
});

test('manifest context, baseline, aliases and revisions cannot silently drift', () => {
  const { manifest } = fixture();
  for (const key of ['krok', 'namespace', 'schemaVersion', 'hashSpec', 'baseline']) {
    const next = clone(manifest); next[key] = null;
    assert.throws(() => validateTransition(manifest, next), /Immutable/);
  }
  const next = clone(manifest); next.manifestRevision++;
  next.aliases.push({ format: 'source', value: 'new-source', targetLegacyId: 1 });
  assert.throws(() => validateTransition(manifest, next), /Alias/);
  next.aliases = []; next.manifestRevision++;
  assert.throws(() => validateTransition(manifest, next), /revision/);
});

test('published-byte verification rejects even semantically equal reformatted data', async () => {
  for (const config of BANKS) {
    const bytes = bankBytes(config);
    const proof = await verifyPublished(config, bytes, async url => { assert.equal(url, `https://kroktrainer.com/${config.path}`); return bytes; });
    assert.equal(proof.sha256, config.sha256);
    await assert.rejects(verifyPublished(config, bytes, async () => Buffer.concat([bytes, Buffer.from(' ')])), /mismatch/);
    await assert.rejects(verifyPublished(config, bytes, async () => { throw new Error('network unavailable'); }), /network unavailable/);
  }
});

test('browser-compatible resolver has no DOM, storage, network or initialization side effects', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, 'question-identity.js'), 'utf8'), context);
  assert.equal(typeof context.QuestionIdentity.createResolver, 'function');
  assert.deepEqual(Object.keys(context), ['QuestionIdentity']);
  assert.equal(context.QuestionIdentity.createResolver(clone(manifests)).resolveIdentity({ krok: 1, format: 'bank', id: 1 }).status, 'resolved');
});

test('CLI validation is read-only and bootstrap refuses to overwrite existing manifests before any network call', () => {
  const paths = BANKS.flatMap(c => [c.path, `data/question-identity/krok${c.krok}-main.manifest.json`]);
  const before = paths.map(p => sha256(fs.readFileSync(path.join(root, p))));
  const output = execFileSync(process.execPath, ['scripts/question-identity/check-manifests.js'], { cwd: root, encoding: 'utf8' });
  assert.match(output, /informational_only/);
  const refused = spawnSync(process.execPath, ['scripts/question-identity/bootstrap.js', '--write'], { cwd: root, encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Refusing to overwrite/);
  assert.deepEqual(paths.map(p => sha256(fs.readFileSync(path.join(root, p)))), before);
});

test('similar text is not an alias and cannot select another record through fuzzy matching', () => {
  const { q, manifest } = fixture();
  const resolver = identity.createResolver([manifest]);
  assert.equal(resolver.resolveLegacyMistake({ question: 'Question?', answers: q.answers, correct: 0 }, new Map([[1, [q]]])).status, 'unresolved');
  assert.equal(resolver.resolveLegacyMistake({ question: 'question', answers: q.answers, correct: 0 }, new Map([[1, [q]]])).status, 'unresolved');
});

test('KROK 2 allocation preserves padding and safely extends beyond four digits', () => {
  const q = { ...fixture(2).q, id: 'krok2-9999' };
  const bytes = Buffer.from(JSON.stringify([q]));
  const before = createManifest({ krok: 2, path: 'krok2/questions-krok2.json', count: 1, sha256: sha256(bytes) }, bytes);
  assert.equal(before.nextOrdinal, 10000);
  const after = clone(before); after.manifestRevision++; after.nextOrdinal = 10001;
  const added = { ...after.entries[0], legacyId: 'krok2-10000' }; after.entries.push(added);
  validateTransition(before, after, [plan(null, added, 'add')]);
  assert.equal(identity.createResolver([after]).resolveIdentity({ krok: 2, format: 'bank', id: 'krok2-10000' }).status, 'resolved');
  added.legacyId = 'krok2-0001';
  assert.throws(() => validateTransition(before, after, [plan(null, added, 'add')]), /reserved/);
});

test('metadata-only bank changes still fail the independent publication gate', () => {
  const { q, manifest } = fixture();
  const bytes = Buffer.from(JSON.stringify([{ ...q, subject: 'Other classification' }]));
  const next = clone(manifest); next.manifestRevision++; next.currentBankSha256 = sha256(bytes);
  // Content fingerprints are not classification or identity keys.
  validateManifest(next, bytes);
  assert.throws(() => validateTransition(manifest, next), /approval/);
});
