import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createCollectionService } from '../server/collection-service.mjs';
import { createWishlistService } from '../server/wishlist-service.mjs';
import { createWriteQueue, OperationError } from '../server/record-operations.mjs';
import { createApp } from '../server/app.mjs';
import { recordRevision } from '../src/collection-record.mjs';
import { wishlistRevision } from '../src/wishlist-record.mjs';
import { record } from './fixtures/collection.mjs';
import { wish } from './fixtures/wishlist.mjs';
import { testAuth, loginOwner } from './fixtures/auth.mjs';
const otherId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const draft = ({ id, ...value }) => value;
function memory(initial) {
  const m = { records: structuredClone(initial), writes: 0 };
  m.getCollection = m.getWishlist = async () => structuredClone(m.records);
  m.updateRecord = async value => { m.writes++; m.records = m.records.map(r => r.id === value.id ? structuredClone(value) : r); };
  m.deleteRecord = async value => { m.writes++; m.records = m.records.filter(r => r.id !== value.id); };
  return m;
}
for (const wishlist of [false, true]) {
  const source = wishlist ? wish : record;
  const revision = wishlist ? wishlistRevision : recordRevision;
  const setup = (initial = [source], owned = []) => {
    const repo = memory(initial); const collection = memory(owned); const serial = createWriteQueue();
    const service = wishlist ? createWishlistService(repo, collection, serial) : createCollectionService(repo, serial);
    return { repo, collection, service, update: wishlist ? service.updateWishlistRecord : service.updateRecord,
      remove: wishlist ? service.deleteWishlistRecord : service.deleteRecord };
  };
  test(`${wishlist ? 'wishlist' : 'collection'} PUT preserves UUID, clears nullable fields, keeps zero and legacy genre`, async () => {
    const neighbor = { ...source, id: otherId, album: 'Neighbor' };
    const m = setup([source, neighbor]);
    const input = { ...draft(source), note: null, genre: 'Legacy genre', additionalGenre: null,
      ...(wishlist ? { storeUrl: null } : { purchasePrice: 0, purchaseDate: null, purchaseStore: null }) };
    const actual = await m.update(source.id.toUpperCase(), await revision(source), input);
    assert.deepEqual(actual, { ...input, id: source.id });
    assert.deepEqual(m.repo.records, [actual, neighbor]); assert.equal(m.repo.writes, 1);
  });
  test(`${wishlist} PUT rejects invalid bodies/versions, missing and stale records before writes`, async () => {
    const m = setup(); const expected = await revision(source);
    for (const input of [source, {}, { ...draft(source), unknown: 1 }, { ...draft(source), album: '' }]) {
      await assert.rejects(m.update(source.id, expected, input), { status: 400 });
    }
    for (const value of [undefined, '*', 'bad']) await assert.rejects(m.update(source.id, value, draft(source)), { status: 400 });
    await assert.rejects(m.update(otherId, expected, draft(source)), { status: 404 });
    await assert.rejects(m.update(source.id, await revision({ ...source, note: 'old' }), draft(source)), error => {
      assert.equal(error.message, 'RECORD_CHANGED'); assert.deepEqual(error.details.record, source); return true;
    });
    assert.equal(m.repo.writes, 0);
  });
  test(`${wishlist} PUT excludes self but blocks confirmed duplicates and permits incomplete matches`, async () => {
    const neighbor = { ...source, id: otherId, album: 'Other' }; const m = setup([source, neighbor]);
    await assert.rejects(m.update(source.id, await revision(source), draft(neighbor)), { status: 409, message: 'POTENTIAL_DUPLICATE' });
    const updated = await m.update(source.id, await revision(source), { ...draft(neighbor), label: null });
    assert.equal(updated.id, source.id); assert.equal(m.repo.writes, 1);
  });
  test(`${wishlist} PUT verifies lost response, never retries ambiguous or collateral writes`, async () => {
    for (const mode of ['lost', 'missing', 'altered', 'unreadable', 'collateral', 'conflict']) {
      const neighbor = { ...source, id: otherId, album: 'Other' }; const m = setup([source, neighbor]);
      const update = m.repo.updateRecord;
      m.repo.updateRecord = async value => {
        if (mode === 'conflict') throw new OperationError(409, 'RECORD_CHANGED', { record: source });
        if (mode === 'missing') { m.repo.writes++; throw Error('timeout'); }
        await update(mode === 'altered' ? { ...value, note: 'unexpected' } : value);
        if (mode === 'unreadable') m.repo.getCollection = m.repo.getWishlist = async () => { throw Error('private'); };
        if (mode === 'collateral') m.repo.records[1].album = 'Damaged';
        throw Error('lost response');
      };
      const action = m.update(source.id, await revision(source), { ...draft(source), note: 'new' });
      if (mode === 'lost') assert.equal((await action).note, 'new');
      else await assert.rejects(action, { message: mode === 'conflict' ? 'RECORD_CHANGED' : 'RESULT_UNCONFIRMED' });
      assert.equal(m.repo.writes, mode === 'conflict' ? 0 : 1);
    }
  });
  test(`${wishlist} queue serializes competing edits and deletion`, async () => {
    const m = setup(); const expected = await revision(source);
    const result = await Promise.allSettled([
      m.update(source.id, expected, { ...draft(source), note: 'first' }),
      m.update(source.id, expected, { ...draft(source), note: 'second' }), m.remove(source.id, expected)
    ]);
    assert.equal(result[0].status, 'fulfilled');
    for (const r of result.slice(1)) assert.equal(r.reason.message, 'RECORD_CHANGED');
    assert.equal(m.repo.writes, 1);
  });
  test(`${wishlist} HTTP PUT round trip, 400/404/409/500 and no PATCH`, async t => {
    const m = setup(); const services = wishlist ? { getCollection: async () => [], ...m.service } : m.service;
    const server = createApp(services, { auth: testAuth() }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const base = `http://127.0.0.1:${server.address().port}`; const headers = await loginOwner(base);
    const url = `${base}/api/${wishlist ? 'wishlist' : 'collection'}/${source.id}`;
    const expected = await revision(source);
    const put = (body, extra = {}) => fetch(url, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json', 'If-Match': expected, ...extra }, body: JSON.stringify(body) });
    assert.equal((await put(draft(source), { 'If-Match': '' })).status, 400);
    assert.equal((await put(source)).status, 400);
    const res = await put({ ...draft(source), note: 'updated' }); assert.equal(res.status, 200); assert.equal((await res.json()).id, source.id);
    assert.equal((await put(draft(source))).status, 409);
    assert.equal((await fetch(url, { method: 'PATCH', headers })).status, 405);
    m.repo.records = []; assert.equal((await put(draft(source))).status, 404);
    m.repo.records = [source]; m.repo.updateRecord = async () => { throw Error('secret'); };
    const failure = await put({ ...draft(source), note: 'other' }); assert.equal(failure.status, 500);
    assert.deepEqual(await failure.json(), { error: 'RESULT_UNCONFIRMED', id: source.id });
  });
}
test('wishlist edit checks collection matches; incomplete edition remains allowed', async () => {
  const repo = memory([wish]); const owned = memory([record]); const service = createWishlistService(repo, owned);
  await assert.rejects(service.updateWishlistRecord(wish.id, await wishlistRevision(wish), draft(wish)), { message: 'POTENTIAL_DUPLICATE' });
  const result = await service.updateWishlistRecord(wish.id, await wishlistRevision(wish), { ...draft(wish), label: null });
  assert.equal(result.label, null);
});
