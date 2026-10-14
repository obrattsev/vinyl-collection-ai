import test from 'node:test';
import assert from 'node:assert/strict';
import { createResourceGate } from '../server/security/resource-gate.mjs';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
test('native-work admission bounds concurrency and queue, then drains FIFO', async () => {
  const gate = createResourceGate({ concurrency: 1, capacity: 2 });
  const hold = deferred(), calls = [];
  const first = gate.run(async () => { calls.push(1); await hold.promise; });
  const second = gate.run(() => calls.push(2));
  const third = gate.run(() => calls.push(3));
  await assert.rejects(gate.run(() => calls.push(4)), { code: 'RESOURCE_BUSY' });
  assert.deepEqual(gate.state, { active: 1, waiting: 2 });
  hold.resolve(); await Promise.all([first, second, third]);
  assert.deepEqual(calls, [1, 2, 3]);
});
test('expired queued work never executes and does not block later admission', async () => {
  const gate = createResourceGate({ capacity: 1, timeoutMs: 20 });
  const hold = deferred(); let executed = false;
  const first = gate.run(() => hold.promise);
  await assert.rejects(gate.run(() => { executed = true; }), { code: 'RESOURCE_BUSY' });
  assert.equal(executed, false); assert.equal(gate.state.waiting, 0);
  hold.resolve(); await first;
  assert.equal(await gate.run(() => 'next'), 'next');
});
test('sync and async failures release native-work admission', async () => {
  const gate = createResourceGate();
  await assert.rejects(gate.run(() => { throw Error('fixture'); }), /fixture/);
  await assert.rejects(gate.run(async () => { throw Error('fixture'); }), /fixture/);
  assert.equal(await gate.run(() => 42), 42);
});
