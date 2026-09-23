import { publicRecords } from '../src/public-record.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { createApp } from '../server/app.mjs';
import { CollectionDataError } from '../src/collection-record.mjs';
import { CollectionSourceError } from '../server/google-sheets-collection.mjs';
import { record } from './fixtures/collection.mjs';

async function start(t, getCollection = async () => [record]) {
  const server = createApp({getCollection});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {server.close(resolve); server.closeAllConnections();}));
  return `http://127.0.0.1:${server.address().port}`;
}

test('Guest GET returns the public model and empty collections, never fixture fallbacks', async t => {
  let records = [record];
  const url = await start(t, async () => records);
  const response = await fetch(`${url}/api/collection`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), publicRecords([record]));
  records = [];
  const empty = await fetch(`${url}/api/collection`);
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), []);
});

test('API sanitizes each error class and keeps it distinct from an empty collection', async t => {
  let failure;
  const url = await start(t, async () => {throw failure;});
  for (const [error, code] of [
    [new CollectionDataError(), 'COLLECTION_DATA_INVALID'],
    [new CollectionSourceError(), 'COLLECTION_SOURCE_UNAVAILABLE'],
    [new Error('private-key and access-token and /secret/config'), 'INTERNAL_ERROR']
  ]) {
    failure = error;
    const response = await fetch(`${url}/api/collection`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {error: code});
  }
});

test('invalid repository results cannot become partial successful responses', async t => {
  const url = await start(t, async () => [record, {...record, id:null}]);
  const response = await fetch(`${url}/api/collection`);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {error:'COLLECTION_DATA_INVALID'});
});

test('POST, DELETE and other methods cannot invoke the data source', async t => {
  let called = false;
  const url = await start(t, async () => {called = true; return [];});
  for (const method of ['POST', 'DELETE', 'PUT', 'PATCH', 'OPTIONS']) {
    const response = await fetch(`${url}/api/collection`, {method});
    const safe = method === 'OPTIONS';
    assert.equal(response.status, safe ? 405 : 401);
    assert.deepEqual(await response.json(), {error: safe ? 'METHOD_NOT_ALLOWED' : 'AUTH_REQUIRED'});
  }
  assert.equal((await fetch(`${url}/api/collection/${record.id}`, {method:'DELETE'})).status, 401);
  assert.equal(called, false);
});

test('only the explicit client files are served with correct MIME types', async t => {
  const url = await start(t);
  for (const [path, mime, text] of [
    ['/prototype/', 'text/html', 'Моя коллекция'],
    ['/prototype/index.html', 'text/html', 'Моя коллекция'],
    ['/prototype/app.js', 'text/javascript', "'/api/collection'"],
    ['/prototype/styles.css', 'text/css', 'overflow-x: auto'],
    ['/src/collection-rules.mjs', 'text/javascript', 'searchCollection'],
    ['/src/collection-record.mjs', 'text/javascript', 'validateDraft'],
    ['/src/genres.mjs', 'text/javascript', 'GENRES'],
    ['/prototype/input-controls.mjs', 'text/javascript', 'bindInputConstraint']
  ]) {
    const response = await fetch(url + path);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').includes(mime));
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.ok((await response.text()).includes(text));
  }
  const head = await fetch(`${url}/prototype/app.js`, {method:'HEAD'});
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('secrets, server files, local JSON and encoded/traversal paths are not served', async t => {
  const url = await start(t);
  for (const path of ['/.env', '/.env.example', '/credentials/key.json', '/server/index.mjs',
    '/server/google-sheets-collection.mjs', '/server/collection-service.mjs', '/package.json', '/.git/config',
    '/README.md', '/prototype/data/collection.json', '/node_modules/google-auth-library/package.json',
    '/prototype/../.env', '/prototype/%2e%2e/.env', '/%2eenv', '/prototype/..%2f.env',
    '/prototype/%2e%2e%2fserver/index.mjs', '/prototype/..\\.env']) {
    // Raw request preserves traversal syntax instead of fetch normalizing the path.
    const result = await new Promise((resolve, reject) => {
      const req = request(url, {path}, res => {
        let body = ''; res.setEncoding('utf8'); res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({status:res.statusCode, body}));
      });
      req.on('error', reject); req.end();
    });
    assert.equal(result.status, 404, path);
    assert.deepEqual(JSON.parse(result.body), {error:'NOT_FOUND'});
  }
});

test('UI has no fixture fallback and root points to the existing prototype', async t => {
  const url = await start(t);
  const response = await fetch(url, {redirect:'manual'});
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/prototype/');
  const js = await (await fetch(`${url}/prototype/app.js`)).text();
  assert.ok(!js.includes('collection.json'));
  assert.ok(js.includes('Ошибка загрузки данных. Не удалось загрузить коллекцию.'));
  const html = await (await fetch(`${url}/prototype/`)).text();
  assert.ok(!html.includes('вымышлены'));
  assert.ok(!html.includes('тестовые записи'));
});
