import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { createApp } from '../server/app.mjs';
import { testAuth, password } from './fixtures/auth.mjs';
import { record } from './fixtures/collection.mjs';
import { wish } from './fixtures/wishlist.mjs';
import { publicRecords } from '../src/public-record.mjs';

async function start(t) {
  const origin = 'https://vinyl-collection.ru';
  const server = createApp({ getCollection: async () => [record], getWishlist: async () => [wish] },
    { auth: testAuth({ production: true, origin }) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, call: (path, options = {}) => new Promise((resolve, reject) => {
    const req = request(base + path, { method: options.method,
      headers: { Host: 'vinyl-collection.ru', Origin: origin, ...options.headers }
    }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    });
    req.on('error', reject); req.end(options.body);
  }) };
}

test('root, trailing slashes and legacy page URLs permanently redirect without losing query', async t => {
  const app = await start(t);
  for (const [path, canonical] of [
    ['/', '/collection'], ['/collection/', '/collection'], ['/collection///', '/collection'],
    ['/wishlist/', '/wishlist'], ['/wishlist//', '/wishlist'],
    ['/prototype', '/collection'], ['/prototype/', '/collection'],
    ['/prototype/index.html', '/collection'], ['/prototype/index.html/', '/collection'],
    ['/prototype/wishlist.html', '/wishlist'], ['/prototype/wishlist.html/', '/wishlist']
  ]) {
    for (const method of ['GET', 'HEAD']) {
      const res = await app.call(path + '?test=1&next=%2Fwishlist', { method, redirect: 'manual' });
      assert.equal(res.status, 308, path);
      assert.equal(res.headers.get('location'), canonical + '?test=1&next=%2Fwishlist');
      assert.equal(await res.text(), '');
    }
  }
});

test('direct navigation, refresh and section links resolve to canonical documents', async t => {
  const app = await start(t);
  for (const path of ['/collection', '/wishlist']) {
    const first = await app.call(path, { redirect: 'manual' });
    assert.equal(first.status, 200);
    const html = await first.text();
    assert.equal(await (await app.call(path)).text(), html, 'refresh returns same document');
    const head = await app.call(path, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    assert.equal(head.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.ok(!html.includes('prototype'));
    assert.equal(html.includes('data-section="wishlist"'), path === '/wishlist');
    const nav = html.match(/<nav[^>]*>(.*?)<\/nav>/s)[1];
    const links = [...nav.matchAll(/href="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(links, ['/collection', '/wishlist']);
    for (const link of links) {
      const page = await app.call(new URL(link, app.base + path).pathname);
      assert.equal(new URL(link, app.base + path).pathname, link);
      assert.equal(page.status, 200);
    }
  }
});

test('canonical documents load their complete browser module graph and stylesheet without legacy URLs', async t => {
  const app = await start(t), seen = new Set();
  const queue = ['/collection', '/wishlist'];
  while (queue.length) {
    const path = queue.shift(); if (seen.has(path)) continue; seen.add(path);
    assert.ok(!path.includes('prototype'));
    const res = await app.call(path); assert.equal(res.status, 200, path);
    const body = await res.text(), mime = res.headers.get('content-type');
    if (mime.startsWith('text/html')) {
      for (const match of body.matchAll(/(?:src|href)="([^"]+)"/g)) queue.push(new URL(match[1], app.base + path).pathname);
    } else if (mime.startsWith('text/javascript')) {
      for (const match of body.matchAll(/from ['"]([^'"]+)['"]/g)) queue.push(new URL(match[1], app.base + path).pathname);
    }
  }
  for (const path of ['/assets/app.js', '/assets/styles.css', '/assets/input-controls.mjs', '/src/collection-record.mjs', '/src/wishlist-record.mjs']) assert.ok(seen.has(path), path);
});

test('legacy assets and unknown page paths are not alternate working routes', async t => {
  const app = await start(t);
  for (const path of ['/prototype/app.js', '/prototype/styles.css', '/prototype/input-controls.mjs', '/prototype/unknown', '/collection/index.html', '/wishlist/anything', '/index.html', '/wishlist.html']) {
    const res = await app.call(path, { redirect: 'manual' });
    assert.equal(res.status, 404, path);
  }
});

test('canonical pages preserve production guest, owner login, API projections and logout', async t => {
  const app = await start(t);
  assert.deepEqual(await (await app.call('/api/auth/session')).json(), { role: 'guest' });
  for (const [path, source] of [['/api/collection', record], ['/api/wishlist', wish]]) {
    assert.deepEqual(await (await app.call(path)).json(), publicRecords([source]));
  }
  const login = await app.call('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /^__Host-vinyl_session=/); assert.match(cookie, /; Secure/);
  const { csrfToken } = await login.json();
  const headers = { Cookie: cookie.split(';')[0], 'X-CSRF-Token': csrfToken };
  for (const path of ['/collection', '/wishlist']) assert.equal((await app.call(path, { headers })).status, 200);
  for (const [path, source] of [['/api/collection', record], ['/api/wishlist', wish]]) {
    assert.deepEqual(await (await app.call(path, { headers })).json(), [source]);
  }
  assert.equal((await app.call('/api/auth/logout', { method: 'POST', headers })).status, 200);
  assert.deepEqual(await (await app.call('/api/auth/session', { headers })).json(), { role: 'guest' });
  assert.deepEqual(await (await app.call('/api/collection', { headers })).json(), publicRecords([record]));
});
