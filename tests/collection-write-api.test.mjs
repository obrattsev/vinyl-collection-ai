import { testAuth, loginOwner, ownerFetch as fetch } from './fixtures/auth.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { createApp } from '../server/app.mjs';
import { createCollectionService } from '../server/collection-service.mjs';
import { recordRevision } from '../src/collection-record.mjs';
import { record } from './fixtures/collection.mjs';

async function start(t) {
  let records = [structuredClone(record)]; let writes = 0;
  const repository = {
    getCollection: async () => structuredClone(records),
    appendRecord: async value => { writes++; records.push(value); },
    deleteRecord: async value => { writes++; records = records.filter(r => r.id !== value.id); }
  };
  const server = createApp(createCollectionService(repository), { auth: testAuth() });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const headers = await loginOwner(`http://127.0.0.1:${server.address().port}`);
  return { headers, url: `http://127.0.0.1:${server.address().port}`, get records() { return records; }, get writes() { return writes; }, repository };
}
const { id, ...draft } = record;
const post = (app, value, headers = {}) => fetch(`${app.url}/api/collection`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value)
});

test('HTTP POST → GET → DELETE → GET preserves existing data and returns complete records', async t => {
  const app = await start(t);
  const response = await post(app, { ...draft, album: 'New album' }, { Origin: app.url });
  assert.equal(response.status, 201); const created = await response.json();
  assert.equal(Object.keys(created).length, 13);
  assert.deepEqual(await (await fetch(`${app.url}/api/collection`)).json(), [record, created]);
  const deleted = await fetch(`${app.url}/api/collection/${created.id}`, { method: 'DELETE', headers: { 'If-Match': await recordRevision(created), Origin: app.url } });
  assert.equal(deleted.status, 200); assert.deepEqual(await deleted.json(), created);
  assert.deepEqual(await (await fetch(`${app.url}/api/collection`)).json(), [record]);
  assert.equal(app.writes, 2);
});

test('HTTP validation and duplicates are rejected without writes', async t => {
  const app = await start(t);
  for (const invalid of [record, {}, { ...draft, albumYear: '90' }]) assert.equal((await post(app, invalid)).status, 400);
  const duplicate = await post(app, draft);
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), { error: 'POTENTIAL_DUPLICATE', records: [record] });
  for (const [body, type] of [['{bad', 'application/json'], ['{}', 'text/plain'], ['', 'application/json'], ['x'.repeat(70000), 'application/json']]) {
    const response = await fetch(`${app.url}/api/collection`, { method: 'POST', headers: { 'Content-Type': type }, body });
    assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error: 'INVALID_REQUEST' });
  }
  assert.equal(app.writes, 0);
});

test('HTTP DELETE requires unchanged confirmation and supports renewed confirmation after 409', async t => {
  const app = await start(t); const originalRevision = await recordRevision(record);
  app.records[0].note = 'Changed';
  const response = await fetch(`${app.url}/api/collection/${id}`, { method: 'DELETE', headers: { 'If-Match': originalRevision } });
  assert.equal(response.status, 409);
  const conflict = await response.json(); assert.equal(conflict.record.note, 'Changed');
  assert.equal(app.writes, 0);
  const confirmed = await fetch(`${app.url}/api/collection/${id}`, { method: 'DELETE', headers: { 'If-Match': await recordRevision(conflict.record) } });
  assert.equal(confirmed.status, 200);
  assert.equal((await fetch(`${app.url}/api/collection/${id}`, { method: 'DELETE', headers: { 'If-Match': originalRevision } })).status, 404);
});

test('uncertain writes never expose underlying errors or retry mutations', async t => {
  const app = await start(t); let attempts = 0;
  app.repository.appendRecord = async () => { attempts++; throw new Error('secret-token credential-path'); };
  const response = await post(app, { ...draft, album: 'New' });
  assert.equal(response.status, 500); const result = await response.json();
  assert.deepEqual(Object.keys(result).sort(), ['error', 'id']); assert.equal(result.error, 'RESULT_UNCONFIRMED');
  assert.equal(attempts, 1);
});

test('cross-origin and rebinding write requests are denied before reading or mutating data', async t => {
  const app = await start(t);
  for (const headers of [{ Origin: 'https://attacker.example' }, { Origin: 'null' }, { Host: 'attacker.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    for (const [method, path] of [['POST', '/api/collection'], ['DELETE', `/api/collection/${id}`]]) {
      const response = await new Promise((resolve, reject) => {
        const req = request(app.url + path, { method, headers: { ...app.headers, 'Content-Type': 'application/json', ...headers } }, res => {
          let body = ''; res.setEncoding('utf8'); res.on('data', part => body += part);
          res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
        });
        req.on('error', reject); req.end(method === 'POST' ? JSON.stringify({ ...draft, album: 'New' }) : undefined);
      });
      assert.equal(response.status, 403, JSON.stringify(headers));
      assert.deepEqual(response.body, { error: 'FORBIDDEN' });
    }
  }
  assert.equal(app.writes, 0);
});

test('unsupported methods, invalid targets and unknown paths never write', async t => {
  const app = await start(t);
  for (const method of ['PUT', 'PATCH', 'OPTIONS']) {
    const response = await fetch(`${app.url}/api/collection`, { method });
    assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'GET, POST');
  }
  assert.equal((await fetch(`${app.url}/api/collection/${id}`)).status, 405);
  assert.equal((await fetch(`${app.url}/api/collection/bad`, { method: 'DELETE' })).status, 400);
  assert.equal((await fetch(`${app.url}/api/collection/${id}`, { method: 'DELETE' })).status, 400);
  assert.equal((await fetch(`${app.url}/api/wishlist`, { method: 'POST' })).status, 503);
  assert.equal((await fetch(`${app.url}/api/collection/${id}/other`, { method: 'DELETE' })).status, 404);
  assert.equal(app.writes, 0);
});
