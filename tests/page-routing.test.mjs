import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { createApp } from '../server/app.mjs';
import { testAuth, password } from './fixtures/auth.mjs';
import { record } from './fixtures/collection.mjs';
import { wish } from './fixtures/wishlist.mjs';
import { publicRecords } from '../src/public-record.mjs';

async function start(t, servicesForSession) {
  const origin = 'https://vinyl-collection.ru';
  const server = createApp({ getCollection: async () => [record], getWishlist: async () => [wish] },
    { auth: testAuth({ production: true, origin }), servicesForSession });
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

test('trailing slashes and legacy page URLs permanently redirect without losing query', async t => {
  const app = await start(t);
  for (const [path, canonical] of [
    ['/collection/', '/collection'], ['/collection///', '/collection'],
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

test('root serves a focused landing page instead of redirecting into a collection', async t => {
  const app = await start(t);
  const res = await app.call('/', { redirect: 'manual' });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Vinyl Collection AI/);
  assert.match(html, /href="\/auth\?mode=login"/);
  assert.match(html, /href="\/auth\?mode=registration"/);
  assert.doesNotMatch(html, /Поиск в коллекции|Добавить пластинку|Сообщить об ошибке/);
});

test('auth entry keeps legacy owner rehearsal off the ordinary login screen', async t => {
  const app = await start(t);
  const html = await (await app.call('/auth')).text();
  assert.ok(html.indexOf('id="email-label"') < html.indexOf('id="login-label"'));
  assert.ok(html.indexOf('id="login-label"') < html.indexOf('id="name-label"'));
  assert.match(html, /id="password-error"/);
  assert.doesNotMatch(html, /От 12 до 128 символов\. Можно использовать пробелы/);
  assert.doesNotMatch(html, /id="show-legacy"|Прежний вход владельца/);
  const script = await (await app.call('/assets/auth-ui.mjs')).text();
  assert.match(script, /mode==='legacy-owner'&&config\.legacyEnabled/);
  assert.match(script, /stage==='password'&&\[\.\.\.data\.password\]\.length<12/);
  assert.match(script, /stage==='forgot'\?'Восстановить пароль'/);
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


test('private Collection and Wishlist link directly to login and preserve direct registration', async t => {
  const servicesForSession = Object.assign(() => ({}), {
    profile: async () => { throw Object.assign(new Error('COLLECTION_PRIVATE'), { status: 403 }); }
  });
  const app = await start(t, servicesForSession);
  for (const section of ['collection', 'wishlist']) {
    const response = await app.call(`/alice/${section}`);
    assert.equal(response.status, 403);
    const html = await response.text();
    assert.match(html, /href="\/auth\?mode=login"/);
    assert.match(html, /href="\/auth\?mode=registration"/);
    assert.doesNotMatch(html, /href="\/auth"/);
  }
});

test('landing has five local sleeve assets, four benefits and direct auth links',async t=>{
 const app=await start(t);const html=await(await app.call('/')).text();
 assert.match(html,/Создать коллекцию/);assert.match(html,/У каждой пластинки своя история/);
 assert.equal((html.match(/class="home-benefit"/g)||[]).length,4);
 const sources=[...html.matchAll(/src="(\/assets\/landing\/[^\"]+)"/g)].map(x=>x[1]);assert.equal(sources.length,5);
 for(const src of sources){const res=await app.call(src);assert.equal(res.status,200);assert.equal(res.headers.get('content-type'),'image/webp');assert.ok((await res.arrayBuffer()).byteLength<300000);}
 assert.doesNotMatch(html,/\/api\/|<script/);
});
