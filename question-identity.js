(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.QuestionIdentity = factory();
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';

  function validLegacyId(krok, id) {
    if (krok === 1) return Number.isSafeInteger(id) && id > 0;
    if (krok !== 2 || typeof id !== 'string' || !/^krok2-\d{4,}$/.test(id)) return false;
    const number = Number(id.slice(6));
    return Number.isSafeInteger(number) && number > 0 && id === `krok2-${String(number).padStart(4, '0')}`;
  }

  function canonicalId(krok, id) {
    if (!validLegacyId(krok, id)) throw new TypeError('Invalid legacy question ID');
    return `main:${id}`;
  }

  function createResolver(manifests) {
    const contexts = new Map();
    for (const manifest of manifests) {
      if (manifest.schemaVersion !== 1 || manifest.namespace !== 'main' ||
          ![1, 2].includes(manifest.krok) || contexts.has(manifest.krok)) {
        throw new TypeError('Invalid or duplicate manifest context');
      }
      const entries = new Map(), aliases = new Map();
      for (const entry of manifest.entries) {
        const id = canonicalId(manifest.krok, entry.legacyId);
        if (entries.has(id) || !['active', 'retired'].includes(entry.status)) {
          throw new TypeError('Duplicate ID or invalid manifest entry');
        }
        entries.set(id, Object.freeze({ ...entry }));
      }
      for (const alias of manifest.aliases) {
        // Aliases are source-local, one-hop references to a registered identity.
        // Standard public ID formats cannot be redirected through aliases.
        if (alias.format !== 'source' || typeof alias.value !== 'string' || !alias.value ||
            !validLegacyId(manifest.krok, alias.targetLegacyId) ||
            !entries.has(canonicalId(manifest.krok, alias.targetLegacyId)) || aliases.has(alias.value)) {
          throw new TypeError('Invalid or ambiguous source alias');
        }
        aliases.set(alias.value, alias.targetLegacyId);
      }
      contexts.set(manifest.krok, { entries, aliases });
    }

    function resolveIdentity({ krok, namespace = 'main', format, id } = {}) {
      const fail = reason => ({ status: 'unresolved', reason });
      if (![1, 2].includes(krok)) return fail('explicit_krok_required');
      if (namespace !== 'main' || (typeof id === 'string' &&
          (/^paper:/.test(id) || /^(?:main:|krok1-)?\d{4}-\d+$/.test(id)))) {
        return { status: 'excluded', reason: 'non_main_namespace' };
      }
      const context = contexts.get(krok);
      if (!context) return fail('context_not_loaded');
      let legacyId;
      if (format === 'source') legacyId = context.aliases.get(id);
      else if (format === 'bank') legacyId = id;
      else if (format === 'canonical' && typeof id === 'string' && id.startsWith('main:')) {
        const raw = id.slice(5);
        legacyId = krok === 1 && /^[1-9]\d*$/.test(raw) ? Number(raw) : raw;
      } else if (format === 'history') {
        if (typeof id !== 'string') return fail('history_id_must_be_text');
        legacyId = krok === 1 && /^[1-9]\d*$/.test(id) ? Number(id) : id;
      } else if (format === 'note' && typeof id === 'string') {
        legacyId = krok === 1 && /^krok1-[1-9]\d*$/.test(id) ? Number(id.slice(6)) : id;
      } else if (format === 'deepLink' && typeof id === 'string') {
        const raw = krok === 1 ? id.replace(/^krok1-/i, '') : id;
        if (krok === 1 && /^\d+$/.test(raw)) legacyId = Number(raw);
        else if (krok === 2 && /^\d+$/.test(raw)) legacyId = `krok2-${raw.padStart(4, '0')}`;
        else if (krok === 2 && /^krok2-\d+$/i.test(raw)) legacyId = raw.toLowerCase();
      } else return fail('unsupported_format');
      if (!validLegacyId(krok, legacyId)) return fail('invalid_id');
      const entry = context.entries.get(canonicalId(krok, legacyId));
      if (!entry) return fail('unknown_id');
      return {
        status: entry.status === 'retired' ? 'retired' : 'resolved',
        identity: { krok, questionId: canonicalId(krok, legacyId) },
        legacyId, revision: entry.revision
      };
    }

    function toBankId(identity) {
      const result = resolveIdentity({ krok: identity?.krok, format: 'canonical', id: identity?.questionId });
      if (!['resolved', 'retired'].includes(result.status)) throw new TypeError('Unregistered identity');
      return result.legacyId;
    }

    function toNoteKey(identity) {
      const id = toBankId(identity);
      return identity.krok === 1 ? `krok1-${id}` : id;
    }

    function lookupQuestion(identity, bank) {
      const result = resolveIdentity({ krok: identity?.krok, format: 'canonical', id: identity?.questionId });
      if (result.status !== 'resolved') return { ...result, question: null };
      const matches = bank.filter(q => q.id === result.legacyId);
      if (matches.length !== 1) return { status: matches.length ? 'ambiguous' : 'unresolved', reason: 'bank_lookup_not_unique', question: null };
      return { ...result, question: matches[0] };
    }

    function resolveLegacyMistake(record, banks) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) return { status: 'unresolved', reason: 'invalid_record' };
      if (record.namespace && record.namespace !== 'main') return { status: 'excluded', reason: 'non_main_namespace' };
      // The legacy app records paper provenance in subject, even without an ID.
      if (typeof record.subject === 'string' && record.subject.startsWith('Past Paper')) {
        return { status: 'excluded', reason: 'non_main_namespace' };
      }
      if (record.krok != null && ![1, 2].includes(record.krok)) return { status: 'unresolved', reason: 'invalid_krok' };
      const rawId = record.questionId ?? record.id;
      if (typeof rawId === 'string' && (/^paper:/.test(rawId) || /^(?:krok1-)?\d{4}-\d+$/.test(rawId))) {
        return { status: 'excluded', reason: 'non_main_namespace' };
      }
      const hasSnapshot = typeof record.question === 'string' && Array.isArray(record.answers) &&
        record.answers.length > 0 && record.answers.every(a => typeof a === 'string');
      const correctText = hasSnapshot && Number.isInteger(record.correct) && record.correct >= 0 && record.correct < record.answers.length
        ? record.answers[record.correct] : (typeof record.correctAnswer === 'string' ? record.correctAnswer : null);
      const sameSnapshot = q => q.question === record.question &&
        q.answers.length === record.answers.length && q.answers.every((a, i) => a === record.answers[i]) &&
        correctText !== null && q.answers[q.correct] === correctText;
      const candidates = [];
      for (const [krok, bank] of banks) {
        if (record.krok != null && record.krok !== krok) continue;
        if (rawId != null) {
          const result = resolveIdentity({ krok, format: typeof rawId === 'number' ? 'bank' : 'history', id: rawId });
          if (result.status === 'retired') return result;
          if (result.status === 'resolved') {
            const match = lookupQuestion(result.identity, bank);
            if (match.status === 'resolved' && (!hasSnapshot || sameSnapshot(match.question))) candidates.push(result);
          }
        } else if (hasSnapshot && correctText !== null) {
          for (const q of bank.filter(sameSnapshot)) {
            const result = resolveIdentity({ krok, format: 'bank', id: q.id });
            if (result.status === 'resolved') candidates.push(result);
          }
        }
      }
      if (candidates.length === 1) return candidates[0];
      return { status: candidates.length ? 'ambiguous' : 'unresolved', reason: candidates.length ? 'multiple_records_match' : 'no_verified_match' };
    }

    return Object.freeze({ resolveIdentity, toBankId, toNoteKey, lookupQuestion, resolveLegacyMistake });
  }

  return Object.freeze({ validLegacyId, canonicalId, createResolver });
});
