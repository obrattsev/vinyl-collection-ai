import test from 'node:test';
import assert from 'node:assert/strict';
import { wish, wishDraft, purchase, memoryRepository } from './fixtures/wishlist.mjs';
import { record } from './fixtures/collection.mjs';
import { wishlistRevision } from '../src/wishlist-record.mjs';
import { recordRevision } from '../src/collection-record.mjs';
import { createWishlistService } from '../server/wishlist-service.mjs';
import { createCollectionService } from '../server/collection-service.mjs';
import { createTransferService } from '../server/transfer-service.mjs';
import { createWriteQueue, OperationError } from '../server/record-operations.mjs';
const code = expected => error => error.message === expected;
function setup(wishes = [wish], owned = []) {
  const wishlist = memoryRepository(wishes), collection = memoryRepository(owned, 'collection'), serial = createWriteQueue();
  return { wishlist, collection, service: createWishlistService(wishlist, collection, serial),
    collectionService: createCollectionService(collection, serial), transfer: createTransferService(wishlist, collection, serial) };
}
test('wishlist creation validates, assigns UUID, preserves neighbors and blocks own/owned duplicates', async () => {
  const { wishlist, collection, service } = setup([]);
  await assert.rejects(service.createWishlistRecord({ ...wishDraft, id: wish.id }), code('INVALID_RECORD'));
  const created = await service.createWishlistRecord(wishDraft);
  assert.notEqual(created.id, wish.id); assert.deepEqual(await service.getWishlist(), [created]);
  await assert.rejects(service.createWishlistRecord(wishDraft), code('POTENTIAL_DUPLICATE'));
  wishlist.replace([]); collection.replace([record]);
  await assert.rejects(service.createWishlistRecord(wishDraft), code('POTENTIAL_DUPLICATE'));
  const different = await service.createWishlistRecord({ ...wishDraft, label: 'Different label' });
  assert.equal(different.label, 'Different label'); assert.deepEqual(await collection.read(), [record]);
});
test('wishlist unavailable collection blocks add before writing; lost response is verified without retry', async () => {
  const { wishlist, collection, service } = setup([]);
  collection.read = async () => { throw Error('source'); };
  await assert.rejects(service.createWishlistRecord(wishDraft)); assert.equal(wishlist.writes.length, 0);
  collection.read = async () => [];
  const append = wishlist.appendRecord; wishlist.appendRecord = async value => { await append(value); throw Error('timeout'); };
  const created = await service.createWishlistRecord(wishDraft); assert.equal(wishlist.writes.length, 1); assert.ok(created.id);
});
test('wishlist delete uses revision, preserves neighbors and rejects disappeared/changed records', async () => {
  const neighbor = { ...wish, id: '00000000-0000-4000-8000-000000000002', album: 'Neighbor' };
  const { service, wishlist } = setup([wish, neighbor]);
  await assert.rejects(service.deleteWishlistRecord(wish.id, 'bad'), code('INVALID_REQUEST'));
  await assert.rejects(service.deleteWishlistRecord(wish.id, await wishlistRevision({ ...wish, note: 'changed' })), code('RECORD_CHANGED'));
  assert.equal(wishlist.writes.length, 0);
  assert.deepEqual(await service.deleteWishlistRecord(wish.id, await wishlistRevision(wish)), wish);
  assert.deepEqual(await wishlist.read(), [neighbor]);
  await assert.rejects(service.deleteWishlistRecord(wish.id, await wishlistRevision(wish)), code('NOT_FOUND'));
});
test('wishlist writes serialize duplicate submissions and never silently accept unverified results', async () => {
  const { service, wishlist } = setup([]);
  const result = await Promise.allSettled([service.createWishlistRecord(wishDraft), service.createWishlistRecord(wishDraft)]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
  wishlist.replace([]); wishlist.appendRecord = async () => {};
  await assert.rejects(service.createWishlistRecord(wishDraft), code('RESULT_UNCONFIRMED'));
});
test('transfer confirms collection before removing wishlist, generates new UUID and preserves unrelated records', async () => {
  const neighbor = { ...wish, id: '00000000-0000-4000-8000-000000000002', album: 'Neighbor' };
  const { wishlist, collection, transfer } = setup([wish, neighbor]);
  const remove = wishlist.deleteRecord;
  wishlist.deleteRecord = async (...args) => { assert.equal((await collection.read()).length, 1); await remove(...args); };
  const result = await transfer(wish.id, await wishlistRevision(wish), purchase);
  assert.equal(result.status, 'complete'); assert.notEqual(result.collectionRecord.id, wish.id);
  assert.equal(result.collectionRecord.purchasePrice, 0); assert.ok(!Object.hasOwn(result.collectionRecord, 'storeUrl'));
  assert.deepEqual(await wishlist.read(), [neighbor]); assert.equal((await collection.read()).length, 1);
});
test('transfer validates source, payload and duplicates before any mutation', async () => {
  const { wishlist, collection, transfer } = setup([wish], [record]);
  await assert.rejects(transfer(wish.id, 'bad', purchase), code('INVALID_REQUEST'));
  await assert.rejects(transfer(wish.id, await wishlistRevision({ ...wish, note: 'old' }), purchase), code('RECORD_CHANGED'));
  await assert.rejects(transfer(wish.id, await wishlistRevision(wish), { ...purchase, artist: 'edited' }), code('INVALID_RECORD'));
  await assert.rejects(transfer(wish.id, await wishlistRevision(wish), purchase), code('POTENTIAL_DUPLICATE'));
  assert.equal(wishlist.writes.length + collection.writes.length, 0);
});
test('unconfirmed collection creation never removes source, including an applied but unreadable write', async () => {
  for (const applied of [false, true]) {
    const { wishlist, collection, transfer } = setup();
    const append = collection.appendRecord;
    collection.appendRecord = async value => {
      if (applied) { await append(value); collection.read = async () => { throw Error('unreadable'); }; }
      throw Error('timeout');
    };
    await assert.rejects(transfer(wish.id, await wishlistRevision(wish), purchase), code('RESULT_UNCONFIRMED'));
    assert.deepEqual(await wishlist.read(), [wish]); assert.equal(wishlist.writes.length, 0);
  }
});
test('failed or uncertain source deletion returns explicit partial success without rollback', async () => {
  for (const mode of ['unchanged', 'read-fails', 'changed', 'adapter-conflict']) {
    const { wishlist, collection, transfer } = setup();
    if (mode === 'changed') {
      const append = collection.appendRecord;
      collection.appendRecord = async value => { await append(value); wishlist.replace([{ ...wish, note: 'new version' }]); };
    } else wishlist.deleteRecord = async () => {
      if (mode === 'read-fails') wishlist.read = async () => { throw Error('secret'); };
      if (mode === 'adapter-conflict') throw new OperationError(409, 'RECORD_CHANGED');
      throw Error('timeout');
    };
    const result = await transfer(wish.id, await wishlistRevision(wish), purchase);
    assert.equal(result.status, 'partial'); assert.equal(result.error, 'TRANSFER_DELETE_INCOMPLETE');
    assert.equal((await collection.read()).length, 1); assert.equal(collection.writes.length, 1);
    assert.ok(!JSON.stringify(result).includes('secret'));
    if (mode !== 'read-fails') assert.equal((await wishlist.read()).length, 1);
  }
});
test('retry detects partial transfer even with a new service; explicit existing target completes deletion without append', async () => {
  const { wishlist, collection, transfer } = setup(); const remove = wishlist.deleteRecord;
  wishlist.deleteRecord = async () => { throw Error('not deleted'); };
  const partial = await transfer(wish.id, await wishlistRevision(wish), purchase);
  const retry = createTransferService(wishlist, collection);
  await assert.rejects(retry(wish.id, await wishlistRevision(wish), purchase), code('POTENTIAL_DUPLICATE'));
  wishlist.deleteRecord = remove;
  const owned = partial.collectionRecord;
  const result = await retry(wish.id, await wishlistRevision(wish), { collectionId: owned.id, collectionRevision: await recordRevision(owned) });
  assert.equal(result.status, 'complete'); assert.equal(collection.writes.length, 1); assert.deepEqual(await wishlist.read(), []);
});
test('completion requires current explicitly chosen matching collection record and never deletes on changed target', async () => {
  const { wishlist, collection, transfer } = setup([wish], [record]);
  const input = { collectionId: record.id, collectionRevision: await recordRevision(record) };
  collection.replace([{ ...record, note: 'changed' }]);
  await assert.rejects(transfer(wish.id, await wishlistRevision(wish), input), code('RECORD_CHANGED'));
  const unrelated = { ...record, album: 'Unrelated' }; collection.replace([unrelated]);
  await assert.rejects(transfer(wish.id, await wishlistRevision(wish), { ...input, collectionRevision: await recordRevision(unrelated) }), code('TRANSFER_TARGET_MISMATCH'));
  assert.equal(wishlist.writes.length, 0);
});
test('lost responses on both applied transfer writes still produce verified success, no retry', async () => {
  const { wishlist, collection, transfer } = setup();
  const append = collection.appendRecord, remove = wishlist.deleteRecord;
  collection.appendRecord = async value => { await append(value); throw Error('lost'); };
  wishlist.deleteRecord = async value => { await remove(value); throw Error('lost'); };
  assert.equal((await transfer(wish.id, await wishlistRevision(wish), purchase)).status, 'complete');
  assert.equal(wishlist.writes.length, 1); assert.equal(collection.writes.length, 1);
});
test('one queue serializes transfer with ordinary collection/wishlist writes', async () => {
  const { collectionService, transfer, collection, wishlist } = setup();
  const revision = await wishlistRevision(wish);
  const result = await Promise.allSettled([transfer(wish.id, revision, purchase), collectionService.createRecord(Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'id')))]);
  assert.equal(result[0].status, 'fulfilled'); assert.equal(result[1].status, 'rejected');
  assert.equal((await collection.read()).length, 1); assert.equal((await wishlist.read()).length, 0);
});

test('incomplete edition additions are allowed symmetrically in collection and across wishlist sources', async () => {
  const incomplete = {...record, label:null, recordYear:null, editionType:null};
  const {id, ...incompleteDraft} = incomplete;
  const {id: recordId, ...completeDraft} = record;
  for (const [existing, draft] of [[incomplete,completeDraft], [record,incompleteDraft]]) {
    const own = memoryRepository([existing], 'collection');
    assert.ok((await createCollectionService(own).createRecord(draft)).id);
    const {purchaseDate,purchaseStore,purchasePrice,...common} = draft;
    for (const source of ['wishlist','collection']) {
      const {purchaseDate,purchaseStore,purchasePrice,...existingCommon} = existing;
      const app = setup(source === 'wishlist' ? [{...existingCommon,storeUrl:null}] : [], source === 'collection' ? [existing] : []);
      assert.ok((await app.service.createWishlistRecord({...common,storeUrl:null})).id);
    }
  }
});
test('partial transfer with unknown edition is detected after service restart and completed without append', async () => {
  const source = {...wish,label:null,recordYear:null,editionType:null};
  const app = setup([source]); const remove = app.wishlist.deleteRecord;
  app.wishlist.deleteRecord = async () => { throw Error('unavailable'); };
  const first = await app.transfer(source.id, await wishlistRevision(source), purchase);
  assert.equal(first.status, 'partial');
  const retry = createTransferService(app.wishlist, app.collection);
  await assert.rejects(retry(source.id, await wishlistRevision(source), purchase), code('POTENTIAL_DUPLICATE'));
  app.wishlist.deleteRecord = remove;
  const result = await retry(source.id, await wishlistRevision(source), {collectionId:first.collectionRecord.id,collectionRevision:await recordRevision(first.collectionRecord)});
  assert.equal(result.status,'complete'); assert.equal(app.collection.writes.length,1);
  assert.deepEqual(await app.wishlist.read(), []);
});
