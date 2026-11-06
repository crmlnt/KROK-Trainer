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
  function friendlyError(error) {
    if (error?.code === 'PGRST202' || /could not find.*mistake_training_record_practice/i.test(error?.message || '')) {
      return 'Practice sync is awaiting the approved database update. Your pending mistakes are saved on this browser.';
    }
    return error?.message || 'Connection failed. Retry safely; your saved session is preserved.';
  }
  return Object.freeze({ scopedClient, createQueue, practiceIdentity, friendlyError });
});
