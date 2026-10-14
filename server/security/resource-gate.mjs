// Bound native-memory work before it enters libuv's otherwise unbounded queue.
// Callers must not hold a database transaction while waiting for admission.
export function createResourceGate({ concurrency = 1, capacity = 4, timeoutMs = 5000 } = {}) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || !Number.isSafeInteger(capacity) || capacity < 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw Error('Invalid resource gate');
  let active = 0;
  const queue = [];
  const busy = () => Object.assign(new Error('RESOURCE_BUSY'), { code: 'RESOURCE_BUSY' });
  function start(entry) {
    clearTimeout(entry.timer);
    active++;
    Promise.resolve().then(entry.work).then(entry.resolve, entry.reject).finally(() => {
      active--;
      const next = queue.shift();
      if (next) start(next);
    });
  }
  return {
    run(work) {
      if (typeof work !== 'function') return Promise.reject(new TypeError('Work function required'));
      return new Promise((resolve, reject) => {
        const entry = { work, resolve, reject };
        if (active < concurrency) return start(entry);
        if (queue.length >= capacity) return reject(busy());
        entry.timer = setTimeout(() => {
          const index = queue.indexOf(entry);
          if (index !== -1) { queue.splice(index, 1); reject(busy()); }
        }, timeoutMs);
        queue.push(entry);
      });
    },
    get state() { return { active, waiting: queue.length }; }
  };
}

// Shared by the transitional legacy KDF and multi-user Argon2id.
export const passwordWorkGate = createResourceGate();
