import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createApp } from '../server/app.mjs';
import { createCoverStorage } from '../server/cover-storage.mjs';
import { createPresentationService } from '../server/presentation-service.mjs';
import { createWriteQueue } from '../server/record-operations.mjs';
import { recordRevision } from '../src/collection-record.mjs';
import { wishlistRevision } from '../src/wishlist-record.mjs';
import { record } from './fixtures/collection.mjs';
import { wish, memoryRepository } from './fixtures/wishlist.mjs';
import { testAuth, loginOwner } from './fixtures/auth.mjs';
const image = await sharp({ create: { width: 40, height: 40, channels: 3, background: 'blue' } }).png().toBuffer();
async function start(t) {
  const directory = await mkdtemp(join(tmpdir(), 'vinyl-cover-api-'));
  const covers = createCoverStorage(directory), collection = memoryRepository([record], 'collection'), wishlist = memoryRepository([wish]);
  const services = createPresentationService({ collection, wishlist, covers, serial: createWriteQueue() });
  const server = createApp({ ...services, getCollection: collection.read, getWishlist: wishlist.read }, { auth: testAuth() });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); await rm(directory, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}`, headers = await loginOwner(url);
  return { url, headers, collection, wishlist, covers };
}
test('3D endpoints require owner, correct Origin, CSRF and versions before any write', async t => {
  const app = await start(t);
  for (const [section, source, revision] of [['collection', record, recordRevision], ['wishlist', wish, wishlistRevision]]) {
    for (const method of ['PUT', 'DELETE']) {
      const url = `${app.url}/api/${section}/${source.id}/cover`;
      const valid = { ...app.headers, 'If-Match': await revision(source), 'Content-Type': 'image/png' };
      for (const [headers, status] of [[{ Origin: app.url }, 401], [{ ...valid, Origin: 'https://wrong.example' }, 403], [{ ...valid, 'X-CSRF-Token': '' }, 403], [{ ...valid, 'If-Match': '' }, 400]]) {
        const response = await fetch(url, { method, headers, ...(method === 'PUT' ? { body: image } : {}) });
        assert.equal(response.status, status);
      }
      assert.equal((await fetch(url)).status, 405);
    }
  }
  const favorite = `${app.url}/api/collection/${record.id}/favorite`;
  for (const [headers, status] of [[{ Origin: app.url }, 401], [{ ...app.headers, 'X-CSRF-Token': '' }, 403], [{ ...app.headers, Origin: 'https://wrong.example' }, 403]]) {
    assert.equal((await fetch(favorite, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json', 'If-Match': await recordRevision(record) }, body: '{"favorite":true}' })).status, status);
  }
  assert.equal(app.collection.writes.length + app.wishlist.writes.length, 0);
});
test('3D HTTP add/replace/delete both collections, public media/projection, private fields excluded and favorite only collection', async t => {
  const app = await start(t);
  for (const [section, source, revision] of [['collection', record, recordRevision], ['wishlist', wish, wishlistRevision]]) {
    let current = source;
    for (const method of ['PUT', 'PUT', 'DELETE']) {
      const response = await fetch(`${app.url}/api/${section}/${source.id}/cover`, { method,
        headers: { ...app.headers, 'If-Match': await revision(current), 'Content-Type': 'image/png' }, ...(method === 'PUT' ? { body: image } : {}) });
      assert.equal(response.status, 200); current = await response.json();
      const projected = await (await fetch(`${app.url}/api/${section}`)).json();
      for (const key of ['id', 'coverId', 'purchasePrice', 'purchaseDate', 'purchaseStore', 'storeUrl']) assert.equal(Object.hasOwn(projected[0], key), false);
      if (method === 'PUT') {
        const media = await fetch(app.url + projected[0].cover.imageUrl);
        assert.equal(media.status, 200); assert.equal(media.headers.get('content-type'), 'image/webp');
        assert.equal((await sharp(Buffer.from(await media.arrayBuffer())).metadata()).format, 'webp');
        assert.equal((await fetch(app.url + projected[0].cover.thumbnailUrl, { method: 'HEAD' })).status, 200);
      } else assert.equal(projected[0].cover, null);
    }
    if (section === 'collection') {
      const response = await fetch(`${app.url}/api/collection/${record.id}/favorite`, { method: 'PATCH', headers: { ...app.headers, 'If-Match': await revision(current), 'Content-Type': 'application/json' }, body: '{"favorite":true}' });
      assert.equal(response.status, 200); assert.equal((await response.json()).favorite, true);
      assert.equal((await (await fetch(`${app.url}/api/collection`)).json())[0].favorite, true);
    } else {
      assert.equal((await fetch(`${app.url}/api/wishlist/${wish.id}/favorite`, { method: 'PATCH', headers: app.headers })).status, 404);
    }
  }
  assert.equal((await fetch(`${app.url}/media/covers/${record.id}/original.jpg`)).status, 404);
  assert.equal((await fetch(`${app.url}/media/covers`)).status, 404);
});
test('upload rejects unsupported MIME/corrupt content and concurrent admission is bounded', async t => {
  const app = await start(t); const url = `${app.url}/api/collection/${record.id}/cover`;
  const headers = { ...app.headers, 'If-Match': await recordRevision(record) };
  for (const [type, body, status] of [['image/heic', image, 415], ['image/svg+xml', image, 415], ['image/png', 'broken', 400]]) {
    assert.equal((await fetch(url, { method: 'PUT', headers: { ...headers, 'Content-Type': type }, body })).status, status);
  }
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const original = app.covers.prepare;
  app.covers.prepare = async bytes => { entered(); await new Promise(resolve => { release = resolve; }); return original(bytes); };
  const first = fetch(url, { method: 'PUT', headers: { ...headers, 'Content-Type': 'image/png' }, body: image });
  await waiting;
  const second = await fetch(url, { method: 'PUT', headers: { ...headers, 'Content-Type': 'image/png' }, body: image });
  assert.equal(second.status, 503); assert.equal((await second.json()).error, 'COVER_BUSY');
  release(); assert.equal((await first).status, 200); assert.equal(app.collection.writes.length, 1);
});
