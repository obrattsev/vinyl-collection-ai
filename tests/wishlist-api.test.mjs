import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/app.mjs';
import { createCollectionService } from '../server/collection-service.mjs';
import { createWishlistService } from '../server/wishlist-service.mjs';
import { createTransferService } from '../server/transfer-service.mjs';
import { createWriteQueue } from '../server/record-operations.mjs';
import { WishlistSourceError } from '../server/google-sheets-wishlist.mjs';
import { WishlistDataError, wishlistRevision } from '../src/wishlist-record.mjs';
import { wish, wishDraft, purchase, memoryRepository } from './fixtures/wishlist.mjs';
async function start(t, configured = true) {
  const wishlist = memoryRepository([]), collection = memoryRepository([], 'collection'), serial = createWriteQueue();
  const server = createApp({ ...createCollectionService(collection, serial), ...(configured ? {
    ...createWishlistService(wishlist, collection, serial), transferRecord: createTransferService(wishlist, collection, serial)
  } : {}) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { wishlist, collection, call: (path = '', options = {}) => fetch(`${url}/api/wishlist${path}`, options), url };
}
const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
test('wishlist GET/POST/DELETE return full models, require versions and never return fallback rows', async t => {
  const app = await start(t);
  assert.deepEqual(await (await app.call()).json(), []);
  const response = await app.call('', post(wishDraft)); assert.equal(response.status, 201);
  const created = await response.json(); assert.equal(Object.keys(created).length, 11);
  assert.deepEqual(await (await app.call()).json(), [created]);
  assert.equal((await app.call(`/${created.id}`, { method: 'DELETE' })).status, 400);
  assert.equal((await app.call('', post(wishDraft))).status, 409);
  const removal = { method: 'DELETE', headers: { 'If-Match': await wishlistRevision(created) } };
  assert.deepEqual(await (await app.call(`/${created.id}`, removal)).json(), created);
  assert.equal((await app.call(`/${created.id}`, removal)).status, 404);
  assert.deepEqual(await app.collection.read(), []);
});
test('wishlist GET distinguishes not configured, source, integrity and unexpected failures', async t => {
  const absent = await start(t, false); assert.equal((await absent.call()).status, 503);
  assert.deepEqual(await (await absent.call()).json(), { error: 'WISHLIST_NOT_CONFIGURED' });
  const app = await start(t);
  for (const [failure, code] of [[new WishlistSourceError(), 'WISHLIST_SOURCE_UNAVAILABLE'], [new WishlistDataError(), 'WISHLIST_DATA_INVALID'], [Error('secret'), 'INTERNAL_ERROR']]) {
    app.wishlist.read = async () => { throw failure; };
    const response = await app.call(); assert.equal(response.status, 500); assert.deepEqual(await response.json(), { error: code });
  }
  app.wishlist.read = async () => [{ ...wish, id: null }];
  assert.deepEqual(await (await app.call()).json(), { error: 'WISHLIST_DATA_INVALID' });
});
test('wishlist and transfer writes retain local origin security and malformed input protection', async t => {
  const app = await start(t); app.wishlist.replace([wish]);
  for (const path of ['', `/${wish.id}/transfer`]) {
    assert.equal((await app.call(path, { ...post(purchase), headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await app.call(path, { ...post(purchase), headers: { 'Content-Type': 'text/plain' } })).status, 400);
    assert.equal((await app.call(path, { ...post(purchase), body: '{broken' })).status, 400);
  }
  assert.equal((await app.call(`/${wish.id}`, { method: 'DELETE', headers: { Origin: 'null' } })).status, 403);
  assert.equal((await app.call('', post({}))).status, 400);
  assert.equal((await app.call('', { method: 'PUT' })).status, 405);
  assert.equal((await app.call(`/${wish.id}/transfer`)).status, 405);
  assert.equal((await app.call(`/${wish.id}/unknown`)).status, 404);
  assert.equal(app.wishlist.writes.length + app.collection.writes.length, 0);
});
test('transfer HTTP exposes distinct complete, partial and unconfirmed creation outcomes', async t => {
  for (const mode of ['complete', 'partial', 'unconfirmed']) {
    const app = await start(t); app.wishlist.replace([wish]);
    if (mode === 'partial') app.wishlist.deleteRecord = async () => { throw Error('secret'); };
    if (mode === 'unconfirmed') app.collection.appendRecord = async () => { throw Error('secret'); };
    const response = await app.call(`/${wish.id}/transfer`, { ...post(purchase), headers: { ...post(purchase).headers, 'If-Match': await wishlistRevision(wish) } });
    const body = await response.json();
    assert.equal(response.status, mode === 'unconfirmed' ? 500 : 200);
    if (mode === 'unconfirmed') assert.equal(body.error, 'RESULT_UNCONFIRMED');
    else assert.equal(body.status, mode);
    assert.ok(!JSON.stringify(body).includes('secret'));
    assert.equal((await app.wishlist.read()).length, mode === 'complete' ? 0 : 1);
  }
});
test('wishlist client modules are served; adapter, fixtures and configuration remain private', async t => {
  const app = await start(t);
  for (const path of ['/prototype/wishlist.html', '/src/base-record.mjs', '/src/wishlist-record.mjs', '/src/wishlist-rules.mjs']) assert.equal((await fetch(app.url + path)).status, 200);
  for (const path of ['/server/transfer-service.mjs', '/tests/fixtures/wishlist.mjs', '/.env', '/docs/wishlist-setup.md']) assert.equal((await fetch(app.url + path)).status, 404);
});
