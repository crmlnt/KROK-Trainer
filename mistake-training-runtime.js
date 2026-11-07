(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrainingRuntime = factory();
})(typeof globalThis === 'undefined' ? this : globalThis, function() {
  'use strict';
  // Capture the account's token at request dispatch. Never fall back to a new account.
  function scopedClient(createClient, auth, url, key, userId) {
    return createClient(url, key, { accessToken: async () => {
      const { data, error } = await auth.getSession();
      if (error) throw error;
      if (!data.session || data.session.user.id !== userId) throw new Error('Account changed. Reload training.');
      return data.session.access_token;
    }});
  }
  function createQueue({ storage, userId, api, uuid, onChange = () => {} }) {
    const key = `krok.mt.events.v1:${userId}`;
    let running;
    const read = () => {
      const raw = storage.getItem(key);
      const value = raw === null ? [] : JSON.parse(raw);
      if (!Array.isArray(value)) throw new Error('Training sync queue is unreadable; saved data was preserved.');
      return value;
    };
    const write = value => storage.setItem(key, JSON.stringify(value));
    return {
      pending: () => read().length,
      add(krok, questionId) {
        const queue = read();
        queue.push({ eventId: uuid(), krok, questionId });
        write(queue);
        onChange();
      },
      flush() {
        if (running) return running;
        running = (async () => {
          while (read().length) {
            const event = read()[0];
            await api.recordPractice(userId, event.eventId, event.krok, event.questionId);
            // Re-read so events added while waiting are not discarded.
            write(read().filter(item => item.eventId !== event.eventId));
            onChange();
          }
        })().finally(() => { running = null; });
        return running;
      }
    };
  }
  function practiceIdentity(identity, detail) {
    if (!detail || detail.pastPaper || ![1,2].includes(detail.krok) ||
        typeof detail.record?.subject !== 'string' || detail.record.subject.startsWith('Past Paper')) return null;
    try { return identity.canonicalId(detail.krok, detail.record.id); } catch (_) { return null; }
  }
  // Versioned presentation order: do not change this seed/PRNG for active sessions.
  // Same Fisher–Yates algorithm as app.js shuffleArray, with a seeded random source.
  function answerOptions({ sessionId, krok, questionId, revision }, answers) {
    const seed = JSON.stringify(['training-options-v1', sessionId, krok, questionId, revision]);
    let value = 2166136261;
    for (let i = 0; i < seed.length; i++) value = Math.imul(value ^ seed.charCodeAt(i), 16777619) >>> 0;
    const random = () => {
      value = (value + 0x6D2B79F5) >>> 0;
      let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
    const options = answers.map((text, originalIndex) => ({ text, originalIndex }));
    for (let i = options.length - 1; i > 0; i--) {
      const other = Math.floor(random() * (i + 1));
      [options[i], options[other]] = [options[other], options[i]];
    }
    return options;
  }
  function friendlyError(error) {
    if (error?.code === 'PGRST202' || /could not find.*mistake_training_record_practice/i.test(error?.message || '')) {
      return 'Practice sync is awaiting the approved database update. Your pending mistakes are saved on this browser.';
    }
    return error?.message || 'Connection failed. Retry safely; your saved session is preserved.';
  }
  return Object.freeze({ scopedClient, createQueue, practiceIdentity, answerOptions, friendlyError });
});
