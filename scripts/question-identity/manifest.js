'use strict';

const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { validLegacyId, createResolver } = require('../../question-identity.js');

const BASELINE_COMMIT = '1596581186ef698a539ec0ec22ef3b73e1aed375';
const BANKS = Object.freeze([
  Object.freeze({ krok: 1, path: 'questions.json', count: 2890, sha256: 'e7e83f93809bd08a903272a0b7c4c5166420135b1c032e169e9b0dea7d661c3c' }),
  Object.freeze({ krok: 2, path: 'krok2/questions-krok2.json', count: 2409, sha256: '0318d565e57956edad31f317641b24edead3882bedbab7d13e97c450d8651aa5' })
]);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => sha256(Buffer.from(JSON.stringify(value), 'utf8'));
const ordinal = id => typeof id === 'number' ? id : Number(id.slice(6));
const fingerprints = q => ({
  contentSha256: digest([q.question, q.answers, q.correct]),
  gradingSha256: digest([q.answers, q.correct])
});

function assertBank(bank, krok) {
  if (!Array.isArray(bank)) throw new TypeError('Bank must be an array');
  const ids = new Set();
  for (const q of bank) {
    if (!q || !validLegacyId(krok, q.id) || !Number.isSafeInteger(ordinal(q.id)) || ordinal(q.id) <= 0 ||
        typeof q.question !== 'string' || !q.question.trim() || typeof q.subject !== 'string' || !q.subject.trim() ||
        !Array.isArray(q.answers) || !q.answers.length || !q.answers.every(a => typeof a === 'string' && a.trim()) ||
        !Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.answers.length) {
      throw new TypeError('Invalid question structure or grading index');
    }
    if (ids.has(String(q.id))) throw new Error(`Duplicate question ID: ${q.id}`);
    ids.add(String(q.id));
  }
}

function createManifest(config, bytes) {
  const bank = JSON.parse(bytes.toString('utf8'));
  assertBank(bank, config.krok);
  if (sha256(bytes) !== config.sha256 || bank.length !== config.count) throw new Error('Bank differs from published foundation baseline');
  return {
    schemaVersion: 1,
    manifestRevision: 1,
    krok: config.krok,
    namespace: 'main',
    hashSpec: 'question-content-v1',
    baseline: { gitCommit: BASELINE_COMMIT, bankPath: config.path, bankSha256: config.sha256, questionCount: config.count,
      publishedUrl: `https://kroktrainer.com/${config.path}`, verifiedOn: '2026-11-06' },
    currentBankSha256: config.sha256,
    nextOrdinal: Math.max(0, ...bank.map(q => ordinal(q.id))) + 1,
    entries: [...bank].sort((a, b) => ordinal(a.id) - ordinal(b.id)).map(q => ({ legacyId: q.id, status: 'active', revision: 1, ...fingerprints(q) })),
    aliases: []
  };
}

function validateManifest(manifest, bytes) {
  const bank = JSON.parse(bytes.toString('utf8'));
  assertBank(bank, manifest.krok);
  createResolver([manifest]);
  if (manifest.hashSpec !== 'question-content-v1' || !Number.isSafeInteger(manifest.manifestRevision) || manifest.manifestRevision < 1 ||
      !Number.isSafeInteger(manifest.nextOrdinal) || manifest.currentBankSha256 !== sha256(bytes)) throw new Error('Invalid manifest version, hash specification or bank checksum');
  const entries = new Map(manifest.entries.map(e => [String(e.legacyId), e]));
  for (const e of manifest.entries) {
    if (!Number.isSafeInteger(e.revision) || e.revision < 1 || !Number.isSafeInteger(ordinal(e.legacyId)) || ordinal(e.legacyId) <= 0 ||
        !/^[a-f0-9]{64}$/.test(e.contentSha256) || !/^[a-f0-9]{64}$/.test(e.gradingSha256)) throw new Error('Invalid entry revision or fingerprint');
  }
  if (manifest.nextOrdinal <= Math.max(0, ...manifest.entries.map(e => ordinal(e.legacyId)))) throw new Error('Allocator would reuse an existing or retired ID');
  const bankIds = new Set(bank.map(q => String(q.id)));
  for (const q of bank) {
    const e = entries.get(String(q.id));
    if (!e || e.legacyId !== q.id || e.status !== 'active') throw new Error(`Unregistered or retired bank ID: ${q.id}`);
    const hashes = fingerprints(q);
    if (e.contentSha256 !== hashes.contentSha256 || e.gradingSha256 !== hashes.gradingSha256) throw new Error(`Unapproved content/grading drift: ${q.id}`);
  }
  for (const e of manifest.entries) if (e.status === 'active' && !bankIds.has(String(e.legacyId))) throw new Error(`Missing active question: ${e.legacyId}`);
  // Equal content across subjects/IDs is intentional and never a validation error.
  const contentCounts = new Map();
  for (const q of bank) {
    const hash = fingerprints(q).contentSha256;
    contentCounts.set(hash, (contentCounts.get(hash) || 0) + 1);
  }
  return { questions: bank.length, retired: manifest.entries.length - bank.length,
    identicalContentGroups: [...contentCounts.values()].filter(n => n > 1).length };
}

function validateTransition(previous, next, approvedChanges = []) {
  for (const key of ['schemaVersion', 'krok', 'namespace', 'hashSpec', 'baseline']) {
    if (!isDeepStrictEqual(previous[key], next[key])) throw new Error(`Immutable manifest field changed: ${key}`);
  }
  createResolver([previous]); createResolver([next]);
  if (isDeepStrictEqual(previous, next)) {
    if (approvedChanges.length) throw new Error('Unused approval plan');
    return;
  }
  if (next.manifestRevision !== previous.manifestRevision + 1 || next.nextOrdinal < previous.nextOrdinal) throw new Error('Manifest revision or allocator moved incorrectly');
  if (!Number.isSafeInteger(next.nextOrdinal) || next.nextOrdinal <= Math.max(0, ...next.entries.map(e => ordinal(e.legacyId)))) throw new Error('Allocator would reuse an ID');
  if (next.currentBankSha256 !== previous.currentBankSha256 && !approvedChanges.length) throw new Error('Bank checksum changes require explicit approval');
  // Source aliases require their own reviewed increment; this foundation never redirects them.
  if (!isDeepStrictEqual(previous.aliases, next.aliases)) throw new Error('Alias changes require separate approval');
  const nextEntries = new Map(next.entries.map(e => [String(e.legacyId), e]));
  const previousIds = new Set(previous.entries.map(e => String(e.legacyId)));
  const approvals = new Map();
  for (const plan of approvedChanges) {
    if (!validLegacyId(next.krok, plan.legacyId) || approvals.has(String(plan.legacyId)) || typeof plan.reason !== 'string' || !plan.reason.trim()) throw new Error('Invalid approval plan');
    approvals.set(String(plan.legacyId), plan);
  }
  function approve(before, after, action) {
    const plan = approvals.get(String(after.legacyId));
    if (!plan || plan.action !== action || !isDeepStrictEqual(plan.before, before) || !isDeepStrictEqual(plan.after, after)) throw new Error(`Missing exact approval for ${action}: ${after.legacyId}`);
    approvals.delete(String(after.legacyId));
  }
  for (const before of previous.entries) {
    const after = nextEntries.get(String(before.legacyId));
    if (!after) throw new Error(`Identity must be retained as a tombstone: ${before.legacyId}`);
    if (isDeepStrictEqual(before, after)) continue;
    if (before.legacyId !== after.legacyId) throw new Error('Legacy ID type changed');
    const contentChanged = before.contentSha256 !== after.contentSha256 || before.gradingSha256 !== after.gradingSha256;
    if (after.revision !== before.revision + (contentChanged ? 1 : 0)) throw new Error('Incorrect content revision increment');
    if (after.status === 'retired' && contentChanged) throw new Error('Retiring an ID cannot replace its content');
    if (before.status === 'retired' && after.status === 'retired') throw new Error('Retired identity cannot be rewritten');
    const action = before.status === 'retired' ? 'reactivate' : (after.status === 'retired' ? 'retire' : 'edit');
    approve(before, after, action);
  }
  for (const after of next.entries) {
    if (previousIds.has(String(after.legacyId))) continue;
    if (ordinal(after.legacyId) < previous.nextOrdinal || after.status !== 'active' || after.revision !== 1) throw new Error('New ID reuses reserved space or has invalid initial state');
    approve(null, after, 'add');
  }
  if (approvals.size) throw new Error('Unused approval plan');
}

async function verifyPublished(config, localBytes, fetchBytes) {
  const url = `https://kroktrainer.com/${config.path}`;
  const published = await fetchBytes(url);
  if (!localBytes.equals(published) || sha256(published) !== config.sha256) throw new Error(`Published bank mismatch: ${config.path}`);
  return { url, sha256: sha256(published), bytes: published.length };
}

module.exports = { BANKS, BASELINE_COMMIT, sha256, fingerprints, assertBank, createManifest, validateManifest, validateTransition, verifyPublished };
