import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { createApp } from '../server/app.mjs';
import { testAuth } from './fixtures/auth.mjs';

const production = { production: true, origin: 'https://vinyl-collection.ru' };
const response = { setHeader() {} };
function peer(address, forwarded, extra = {}) {
  return { socket: { remoteAddress: address }, headers: { 'x-real-ip': forwarded, ...extra } };
}
function exhaust(auth, req, kind, count) {
  for (let i = 0; i < count; i++) auth.limit(req, kind, response);
  assert.throws(() => auth.limit(req, kind, response), { message: 'RATE_LIMITED', status: 429 });
}

for (const [kind, count] of [['login', 5], ['read', 60]]) {
  test(`${kind}: untrusted TCP peers cannot rotate forwarded headers to bypass limits`, () => {
    const auth = testAuth(production);
    for (let i = 0; i < count; i++) {
      auth.limit(peer('198.51.100.1', `203.0.113.${i}`, { 'x-forwarded-for': `192.0.2.${i}`, forwarded: `for=192.0.2.${i}` }), kind, response);
    }
    assert.throws(() => auth.limit(peer('198.51.100.1', '203.0.113.250'), kind, response), { message: 'RATE_LIMITED', status: 429 });
    assert.doesNotThrow(() => auth.limit(peer('198.51.100.2', '203.0.113.250'), kind, response));
  });
}

test('production trusts only loopback; development ignores even valid X-Real-IP', () => {
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    const auth = testAuth(production);
    exhaust(auth, peer(address, '198.51.100.1'), 'login', 5);
    assert.doesNotThrow(() => auth.limit(peer(address, '198.51.100.2'), 'login', response));
  }
  for (const [config, address] of [[{}, '127.0.0.1'], [production, '127.0.0.2'], [production, '10.0.0.1']]) {
    const auth = testAuth(config);
    exhaust(auth, peer(address, '198.51.100.1'), 'login', 5);
    assert.throws(() => auth.limit(peer(address, '198.51.100.2'), 'login', response), { message: 'RATE_LIMITED', status: 429 });
  }
});

test('invalid and absent proxy IPs use the peer bucket, never X-Forwarded-For', () => {
  const auth = testAuth(production);
  exhaust(auth, peer('127.0.0.1', undefined), 'login', 5);
  for (const value of [undefined, '', 'unknown', '1.2.3.999', '198.51.100.1:80', '[::1]', 'fe80::1%eth0', ' 198.51.100.1 ', '198.51.100.1, 198.51.100.2', ['198.51.100.1', '198.51.100.2']]) {
    assert.throws(() => auth.limit(peer('127.0.0.1', value, { 'x-forwarded-for': '203.0.113.1' }), 'login', response), { message: 'RATE_LIMITED', status: 429 });
  }
});

test('equivalent IPv6 and IPv4-mapped representations cannot create extra buckets', () => {
  for (const addresses of [
    ['2001:db8::a', '2001:0DB8:0000:0000:0000:0000:0000:000A'],
    ['198.51.100.1', '::ffff:198.51.100.1', '0:0:0:0:0:ffff:c633:6401']
  ]) {
    const auth = testAuth(production);
    exhaust(auth, peer('127.0.0.1', addresses[0]), 'login', 5);
    for (const address of addresses.slice(1)) {
      assert.throws(() => auth.limit(peer('127.0.0.1', address), 'login', response), { message: 'RATE_LIMITED', status: 429 });
    }
  }
});

async function start(t) {
  let reads = 0, time = 1000000;
  const server = createApp({
    getCollection: async () => { reads++; return []; },
    getWishlist: async () => { reads++; return []; }
  }, { auth: testAuth({ ...production, now: () => time }) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return {
    get reads() { return reads; },
    advance: ms => { time += ms; },
    call: (path, ip, method = 'GET', body, extra = {}) => new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: server.address().port, path, method,
        headers: { Host: 'vinyl-collection.ru', Origin: production.origin, 'Content-Type': 'application/json', 'X-Real-IP': ip, ...extra }
      }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(Buffer.concat(chunks)) }));
      });
      req.on('error', reject); req.end(body);
    })
  };
}

test('production HTTP: login buckets are independent, ignore spoofed XFF and recover after 15 minutes', async t => {
  const app = await start(t);
  for (let i = 0; i < 5; i++) {
    const res = await app.call('/api/auth/login', '198.51.100.1', 'POST', '{"password":"wrong"}', { 'X-Forwarded-For': `203.0.113.${i}` });
    assert.equal(res.status, 401); assert.deepEqual(res.body, { error: 'INVALID_CREDENTIALS' });
  }
  const blocked = await app.call('/api/auth/login', '198.51.100.1', 'POST', '{}');
  assert.equal(blocked.status, 429); assert.equal(blocked.headers['retry-after'], '900');
  assert.equal((await app.call('/api/auth/login', '198.51.100.2', 'POST', '{}')).status, 400);
  assert.equal((await app.call('/api/auth/session', '198.51.100.1')).status, 200);
  app.advance(900000);
  assert.equal((await app.call('/api/auth/login', '198.51.100.1', 'POST', '{}')).status, 400);
});

test('production HTTP: guest API buckets span both lists and session, remain independent and reset', async t => {
  const app = await start(t);
  for (let i = 0; i < 60; i++) {
    assert.equal((await app.call('/api/collection', '198.51.100.1', 'GET', undefined, { 'X-Forwarded-For': `203.0.113.${i}` })).status, 200);
  }
  for (const path of ['/api/collection', '/api/wishlist', '/api/auth/session']) {
    const blocked = await app.call(path, '198.51.100.1');
    assert.equal(blocked.status, 429); assert.equal(blocked.headers['retry-after'], '60');
  }
  assert.equal(app.reads, 60);
  assert.equal((await app.call('/api/wishlist', '198.51.100.2')).status, 200);
  assert.equal(app.reads, 61);
  app.advance(60000);
  assert.equal((await app.call('/api/collection', '198.51.100.1')).status, 200);
});

test('production HTTP: duplicate X-Real-IP headers share fallback bucket', async t => {
  const app = await start(t);
  for (let i = 0; i < 5; i++) {
    assert.equal((await app.call('/api/auth/login', [`198.51.100.${i}`, '203.0.113.1'], 'POST', '{}')).status, 400);
  }
  assert.equal((await app.call('/api/auth/login', ['198.51.100.200', '203.0.113.2'], 'POST', '{}')).status, 429);
  assert.equal((await app.call('/api/auth/login', '198.51.100.200', 'POST', '{}')).status, 400);
});

test('production HTTP: aggregate login and guest ceilings survive distinct client IPs and reset', async t => {
  const app = await start(t);
  for (let i = 0; i < 30; i++) {
    assert.equal((await app.call('/api/auth/login', `198.51.100.${i}`, 'POST', '{}')).status, 400);
  }
  assert.equal((await app.call('/api/auth/login', '203.0.113.1', 'POST', '{}')).status, 429);
  for (let i = 0; i < 300; i++) {
    assert.equal((await app.call('/api/auth/session', `198.51.100.${i % 250}`)).status, 200);
  }
  assert.equal((await app.call('/api/collection', '203.0.113.1')).status, 429);
  assert.equal(app.reads, 0);
  app.advance(900000);
  assert.equal((await app.call('/api/auth/login', '203.0.113.1', 'POST', '{}')).status, 400);
  assert.equal((await app.call('/api/collection', '203.0.113.1')).status, 200);
});
