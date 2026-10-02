import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { createStreamingService } from '../server/streaming-service.mjs';
import { OperationError } from '../server/record-operations.mjs';
import { testAuth, loginOwner } from './fixtures/auth.mjs';
const input = { artist: 'Кино', album: 'Группа крови', albumYear: '1988', storefront: 'ru' };
async function start(t, lookupStreaming) {
  const server = createApp({ getCollection: async () => [], lookupStreaming }, { auth: testAuth() });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, post: (body = input, headers = {}) => fetch(url + '/api/streaming/lookup', { method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }) };
}
test('3E same-origin guest and owner share readonly lookup, strict methods and CSP, collection writes still protected', async t => {
  let calls = 0; const result = { status: 'not_found', storefront: 'ru', candidates: [] };
  const { url, post } = await start(t, async value => { calls++; assert.deepEqual(value, input); return result; });
  assert.deepEqual(await (await post()).json(), result); const owner = await loginOwner(url);
  assert.deepEqual(await (await post(input, owner)).json(), result); assert.equal(calls, 2);
  assert.equal((await post(input, { Origin: 'https://evil.test' })).status, 403); assert.equal(calls, 2);
  const get = await fetch(url + '/api/streaming/lookup'); assert.equal(get.status, 405); assert.equal(get.headers.get('allow'), 'POST');
  const csp = get.headers.get('content-security-policy'); assert.match(csp, /frame-src https:\/\/embed.music.apple.com;/); assert.match(csp, /connect-src 'self';/); assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.equal((await fetch(url + '/api/collection', { method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
});
test('3E endpoint bounds input and streaming limiter does not consume ordinary reads or login', async t => {
  let upstream = 0; const { url, post } = await start(t, createStreamingService({ fetch: async () => { upstream++; throw Error('offline'); } }));
  assert.equal((await post({ ...input, note: 'private' })).status, 400);
  assert.equal((await post({ ...input, album: 'x'.repeat(5000) })).status, 400); assert.equal(upstream, 0);
  for (let i = 0; i < 8; i++) await post({});
  const limited = await post(); assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal((await fetch(url + '/api/collection')).status, 200); assert.ok(await loginOwner(url)); assert.equal(upstream, 0);
});
for (const [code, status] of [['STREAMING_TIMEOUT',504],['STREAMING_RATE_LIMITED',429],['STREAMING_INVALID_RESPONSE',502],['STREAMING_UNAVAILABLE',503],['STREAMING_BUSY',503]]) {
  test(`3E HTTP preserves ${code}`, async t => { const { post } = await start(t, async () => { throw new OperationError(status, code, { retryAfter: 9 }); });
    const response = await post(); assert.equal(response.status, status); assert.equal((await response.json()).error, code); assert.equal(response.headers.get('retry-after'), '9'); });
}
test('3E internal failure remains internal, not not-found or provider failure', async t => {
  const { post } = await start(t, async () => { throw Error('sensitive diagnostic'); }); const response = await post();
  assert.equal(response.status, 500); assert.deepEqual(await response.json(), { error: 'INTERNAL_ERROR' });
});
