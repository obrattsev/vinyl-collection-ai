import { request } from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { authConfiguration, createLimiter } from '../server/auth.mjs';
import { testAuth, loginOwner, passwordHash, password } from './fixtures/auth.mjs';
import { record } from './fixtures/collection.mjs';
import { wish } from './fixtures/wishlist.mjs';
import { PUBLIC_FIELDS, publicRecords, validatePublicRecords } from '../src/public-record.mjs';
import { searchCollection } from '../src/collection-rules.mjs';

async function start(t, config = {}) {
  let reads = 0, writes = 0, time = 1000000;
  const auth = testAuth({ now: () => time, ...config });
  const mutate = async () => { writes++; return {}; };
  const server = createApp({ getCollection: async () => { reads++; return [record]; }, getWishlist: async () => { reads++; return [wish]; },
    createRecord: mutate, deleteRecord: mutate, createWishlistRecord: mutate, deleteWishlistRecord: mutate, transferRecord: mutate }, { auth });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, auth, advance: ms => { time += ms; }, get reads() { return reads; }, get writes() { return writes; },
    call: (path, options = {}) => rawFetch(url + path, { ...options, headers: { Origin: url, ...options.headers } }) };
}
function rawFetch(url, options) {
  return new Promise((resolve, reject) => {
    const req = request(url, options, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    });
    req.on('error', reject); req.end(options.body);
  });
}
const targets = [['POST', '/api/collection'], ['DELETE', `/api/collection/${record.id}`], ['POST', '/api/wishlist'], ['DELETE', `/api/wishlist/${wish.id}`], ['POST', `/api/wishlist/${wish.id}/transfer`]];
const DAY = 86400000;

test('all write routes reject guests and forged sessions before any business reads/writes', async t => {
  const app = await start(t);
  for (const Cookie of ['', 'vinyl_session=owner', `vinyl_session=${'a'.repeat(64)}`, 'role=owner']) {
    for (const [method, path] of targets) {
      const result = await app.call(path, { method, headers: { Cookie, 'X-CSRF-Token': 'forged', Authorization: 'Bearer owner' } });
      assert.equal(result.status, 401); assert.deepEqual(await result.json(), { error: 'AUTH_REQUIRED' });
    }
  }
  assert.equal(app.reads, 0); assert.equal(app.writes, 0);
});
test('guest projection has exactly nine fields, no IDs; both lists remain searchable', async t => {
  const app = await start(t);
  for (const [path, source] of [['/api/collection', record], ['/api/wishlist', wish]]) {
    const res = await app.call(path); const data = await res.json();
    assert.equal(res.headers.get('x-access-role'), 'guest');
    assert.deepEqual(Object.keys(data[0]).sort(), [...PUBLIC_FIELDS].sort());
    assert.deepEqual(validatePublicRecords(data), publicRecords([source]));
    assert.equal(searchCollection(data, { artist: source.artist }).length, 1);
    for (const field of ['id', 'purchaseDate', 'purchasePrice', 'purchaseStore', 'storeUrl']) assert.ok(!Object.hasOwn(data[0], field));
  }
});
test('login gives full owner models; cookie + CSRF allow each existing write route', async t => {
  const app = await start(t); const headers = await loginOwner(app.url);
  for (const [path, source] of [['/api/collection', record], ['/api/wishlist', wish]]) assert.deepEqual(await (await app.call(path, { headers })).json(), [source]);
  for (const [method, path] of targets) {
    const res = await app.call(path, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    assert.ok(res.ok);
  }
  assert.equal(app.writes, 5);
});
test('CSRF, absent/foreign Origin, cross-site and forged Host are rejected before source access', async t => {
  const app = await start(t); const headers = await loginOwner(app.url);
  for (const override of [{ 'X-CSRF-Token': '' }, { 'X-CSRF-Token': 'forged' }, { Origin: 'null' }, { Origin: 'https://evil.example' }, { Host: 'evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    for (const [method, path] of targets) assert.equal((await app.call(path, { method, headers: { ...headers, ...override } })).status, 403);
  }
  const { Origin, ...noOrigin } = headers;
  assert.equal((await fetch(app.url + '/api/collection', { method: 'POST', headers: noOrigin })).status, 403);
  assert.equal(app.reads, 0); assert.equal(app.writes, 0);
});
test('logout revokes the server session, expires cookie, and prevents replay', async t => {
  const app = await start(t); const headers = await loginOwner(app.url);
  const out = await app.call('/api/auth/logout', { method: 'POST', headers });
  assert.equal(out.status, 200); assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  for (const [method, path] of targets) assert.equal((await app.call(path, { method, headers })).status, 401);
  assert.deepEqual(await (await app.call('/api/auth/session', { headers })).json(), { role: 'guest' });
  assert.deepEqual(await (await app.call('/api/collection', { headers })).json(), publicRecords([record]));
});
test('idle timeout, absolute seven-day lifetime, and restart invalidate sessions', async t => {
  const idle = await start(t); const h = await loginOwner(idle.url); idle.advance(DAY);
  assert.equal((await idle.call('/api/collection', { method: 'POST', headers: h })).status, 401);
  const active = await start(t); const headers = await loginOwner(active.url);
  for (let i = 0; i < 13; i++) { active.advance(DAY / 2); assert.equal((await (await active.call('/api/auth/session', { headers })).json()).role, 'owner'); }
  active.advance(DAY / 2);
  assert.equal((await (await active.call('/api/auth/session', { headers })).json()).role, 'guest');
  const restarted = await start(t);
  assert.equal((await restarted.call('/api/collection', { method: 'POST', headers: { ...headers, Origin: restarted.url } })).status, 401);
});
test('login rotates a presented session and duplicate cookies do not grant access', async t => {
  const app = await start(t); const headers = await loginOwner(app.url);
  const res = await app.call('/api/auth/login', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  assert.equal(res.status, 200); assert.notEqual(res.headers.get('set-cookie').split(';')[0], headers.Cookie);
  assert.equal((await app.call('/api/collection', { method: 'POST', headers })).status, 401);
  const fresh = res.headers.get('set-cookie').split(';')[0];
  assert.equal((await (await app.call('/api/auth/session', { headers: { Cookie: `${fresh}; ${fresh}` } })).json()).role, 'guest');
});
test('invalid login is generic, bounded, rate limited and forwarded headers cannot bypass limits', async t => {
  const app = await start(t);
  for (let i = 0; i < 5; i++) {
    const res = await app.call('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `1.2.3.${i}` }, body: JSON.stringify({ password: 'wrong' }) });
    assert.equal(res.status, 401); assert.deepEqual(await res.json(), { error: 'INVALID_CREDENTIALS' });
  }
  const blocked = await app.call('/api/auth/login', { method: 'POST' });
  assert.equal(blocked.status, 429); assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  app.advance(15 * 60000);
  const bad = await app.call('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'x'.repeat(1025) }) });
  assert.equal(bad.status, 400); assert.deepEqual(await bad.json(), { error: 'INVALID_REQUEST' });
  const headers = await loginOwner(app.url); assert.ok(headers.Cookie);
});
test('public GET limit stops source reads and recovers; authenticated reads retain access', async t => {
  const app = await start(t); const headers = await loginOwner(app.url);
  for (let i = 0; i < 60; i++) assert.equal((await app.call('/api/collection', { headers: { 'X-Forwarded-For': `10.0.0.${i}` } })).status, 200);
  const denied = await app.call('/api/wishlist'); assert.equal(denied.status, 429); assert.equal(app.reads, 60);
  assert.equal((await app.call('/api/wishlist', { headers })).status, 200);
  app.advance(60000); assert.equal((await app.call('/api/collection')).status, 200);
});
test('aggregate limiter bounds distinct peers and resets', () => {
  let now = 0; const check = createLimiter({ limit: 2, total: 3, windowMs: 1000, now: () => now });
  assert.equal(check('a'), 0); assert.equal(check('a'), 0); assert.equal(check('a'), 1);
  assert.equal(check('b'), 0); assert.equal(check('c'), 1); now = 1000; assert.equal(check('c'), 0);
});
test('production cookie and config fail closed without valid hash and HTTPS origin', async t => {
  for (const env of [{}, { APP_ORIGIN: 'http://example.com', NODE_ENV: 'production' }, { APP_ORIGIN: 'https://example.com/' }, { APP_ORIGIN: 'http://attacker.example' }]) assert.throws(() => authConfiguration(env));
  assert.throws(() => testAuth({ passwordHash: 'plaintext' }));
  assert.throws(() => testAuth({ production: true }));
  const config = authConfiguration({ OWNER_PASSWORD_HASH: passwordHash, NODE_ENV: 'production', APP_ORIGIN: 'https://vinyl.example' });
  const app = await start(t, config);
  const res = await app.call('/api/auth/login', { method: 'POST', headers: { Host: 'vinyl.example', Origin: 'https://vinyl.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie');
  for (const part of ['__Host-vinyl_session=', 'Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/', 'Max-Age=604800']) assert.ok(cookie.includes(part));
  assert.ok(!cookie.includes('Domain=')); assert.ok(!cookie.includes(password));
});
test('session response is no-store, guest contains no CSRF token; unknown/misused auth endpoints are inert', async t => {
  const app = await start(t);
  const res = await app.call('/api/auth/session');
  assert.deepEqual(await res.json(), { role: 'guest' }); assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal((await app.call('/api/auth/login')).status, 405);
  assert.equal((await app.call('/api/auth/unknown')).status, 404);
  assert.equal(app.reads + app.writes, 0);
});
