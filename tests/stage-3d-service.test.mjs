import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createCoverStorage, COVER_MAX_BYTES } from '../server/cover-storage.mjs';
import { createPresentationService } from '../server/presentation-service.mjs';
import { createCollectionService } from '../server/collection-service.mjs';
import { createWishlistService } from '../server/wishlist-service.mjs';
import { createTransferService } from '../server/transfer-service.mjs';
import { createWriteQueue } from '../server/record-operations.mjs';
import { recordRevision, validateDraft } from '../src/collection-record.mjs';
import { wishlistRevision, validateWishlistDraft } from '../src/wishlist-record.mjs';
import { record } from './fixtures/collection.mjs';
import { wish, purchase, memoryRepository } from './fixtures/wishlist.mjs';
const bytes = await sharp({ create: { width: 1800, height: 900, channels: 3, background: '#806050' } }).png().toBuffer();
async function setup(t, collectionRecords = [record], wishlistRecords = [wish]) {
  const directory = await mkdtemp(join(tmpdir(), 'vinyl-covers-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const covers = createCoverStorage(directory), serial = createWriteQueue();
  const collection = memoryRepository(collectionRecords, 'collection'), wishlist = memoryRepository(wishlistRecords);
  const service = createPresentationService({ collection, wishlist, covers, serial });
  return { directory, covers, collection, wishlist, serial, ...service };
}
test('covers normalize JPEG/PNG/WebP, strip metadata/originals and bound dimensions and permissions', async t => {
  const app = await setup(t);
  for (const format of ['jpeg', 'png', 'webp']) {
    const input = await sharp(bytes).withMetadata({ orientation: 6 }).toFormat(format).toBuffer();
    const id = await app.covers.prepare(input);
    assert.deepEqual((await readdir(join(app.directory, id))).sort(), ['image.webp', 'thumb.webp']);
    for (const [file, limit] of [['image.webp', 1200], ['thumb.webp', 144]]) {
      const meta = await sharp(await app.covers.read(id, file)).metadata();
      assert.equal(meta.format, 'webp'); assert.ok(meta.width <= limit && meta.height <= limit);
      assert.equal(meta.exif, undefined); assert.equal(meta.orientation, undefined);
      assert.equal((await stat(join(app.directory, id, file))).mode & 0o777, 0o600);
    }
    assert.equal((await stat(join(app.directory, id))).mode & 0o777, 0o700);
  }
});
test('invalid, SVG, oversized/pixel-bomb and truncated images create no assets; traversal is refused', async t => {
  const app = await setup(t);
  const huge = await sharp({ create: { width: 4100, height: 4000, channels: 3, background: 'white' } }).png().toBuffer();
  for (const input of [Buffer.from('not an image'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'), Buffer.alloc(COVER_MAX_BYTES + 1), huge, bytes.subarray(0, 50)]) {
    await assert.rejects(app.covers.prepare(input), { message: 'INVALID_COVER' });
  }
  assert.deepEqual(await readdir(app.directory), []);
  await assert.rejects(app.covers.read('../secret', 'image.webp'), { status: 404 });
  await assert.rejects(app.covers.read(record.id, '../secret'), { status: 404 });
});
for (const section of ['collection', 'wishlist']) {
  const source = section === 'collection' ? record : wish;
  const revision = section === 'collection' ? recordRevision : wishlistRevision;
  test(`${section} cover add, metadata edit, replace and delete verify links before removing old files`, async t => {
    const app = await setup(t);
    const added = await app.changeCover(section, source.id, await revision(source), bytes);
    assert.ok(added.coverId); assert.ok(await app.covers.read(added.coverId, 'image.webp'));
    const { id, coverId, favorite, ...draft } = added;
    const update = section === 'collection' ? createCollectionService(app.collection, app.serial).updateRecord : createWishlistService(app.wishlist, memoryRepository([], 'collection'), app.serial).updateWishlistRecord;
    const edited = await update(id, await revision(added), { ...draft, note: 'Metadata only' });
    assert.equal(edited.coverId, coverId); if (section === 'collection') assert.equal(edited.favorite, favorite);
    const replaced = await app.changeCover(section, id, await revision(edited), bytes);
    assert.notEqual(replaced.coverId, coverId);
    await assert.rejects(app.covers.read(coverId, 'image.webp'), { status: 404 });
    const deleted = await app.changeCover(section, id, await revision(replaced), null);
    assert.equal(deleted.coverId, null);
    await assert.rejects(app.covers.read(replaced.coverId, 'image.webp'), { status: 404 });
    assert.deepEqual(await readdir(join(app.directory, '.holds')), []);
  });
  test(`${section} version conflict has no write/asset; unknown replace/delete retains both files across restart, no retry`, async t => {
    const app = await setup(t); const repo = app[section];
    const added = await app.changeCover(section, source.id, await revision(source), bytes);
    const before = await readdir(app.directory); const writeCount = repo.writes.length;
    await assert.rejects(app.changeCover(section, source.id, await revision(source), bytes), { message: 'RECORD_CHANGED' });
    assert.deepEqual(await readdir(app.directory), before); assert.equal(repo.writes.length, writeCount);
    let attempts = 0, candidate;
    repo.updateRecord = async value => { attempts++; candidate = value; throw Error('timeout'); };
    await assert.rejects(app.changeCover(section, source.id, await revision(added), bytes), { message: 'RESULT_UNCONFIRMED' });
    assert.equal(attempts, 1); assert.notEqual(candidate.coverId, added.coverId);
    const restarted = createCoverStorage(app.directory);
    for (const id of [added.coverId, candidate.coverId]) {
      await restarted.removeUnreferenced(id, []);
      assert.ok(await restarted.read(id, 'image.webp'));
    }
    await assert.rejects(app.changeCover(section, source.id, await revision(added), null), { message: 'RESULT_UNCONFIRMED' });
    assert.equal(attempts, 2); assert.ok(await restarted.read(added.coverId, 'image.webp'));
  });
  test(`${section} applied write with lost response succeeds once; failed verification never deletes old asset`, async t => {
    const app = await setup(t); const repo = app[section];
    const added = await app.changeCover(section, source.id, await revision(source), bytes);
    const original = repo.updateRecord;
    repo.updateRecord = async value => { await original(value); throw Error('lost'); };
    const next = await app.changeCover(section, source.id, await revision(added), bytes);
    assert.equal(repo.writes.length, 2);
    repo.updateRecord = async value => { await original(value); repo.read = async () => { throw Error('unavailable'); }; };
    await assert.rejects(app.changeCover(section, source.id, await revision(next), bytes), { message: 'RESULT_UNCONFIRMED' });
    assert.equal(repo.writes.length, 3); assert.ok(await app.covers.read(next.coverId, 'image.webp'));
  });
}
test('shared cover survives one unlink; unreadable other collection prevents cleanup', async t => {
  const app = await setup(t);
  const added = await app.changeCover('collection', record.id, await recordRevision(record), bytes);
  app.wishlist.replace([{ ...wish, coverId: added.coverId }]);
  await app.changeCover('collection', record.id, await recordRevision(added), null);
  assert.ok(await app.covers.read(added.coverId, 'image.webp'));
  app.collection.read = async () => { throw Error('unavailable'); };
  await app.changeCover('wishlist', wish.id, await wishlistRevision({ ...wish, coverId: added.coverId }), null);
  assert.ok(await app.covers.read(added.coverId, 'image.webp'));
});
test('unknown transfer append holds shared image even after subsequent wishlist unlink and restart', async t => {
  const app = await setup(t, []);
  const added = await app.changeCover('wishlist', wish.id, await wishlistRevision(wish), bytes);
  let attempts = 0; app.collection.appendRecord = async () => { attempts++; throw Error('unknown'); };
  const transfer = createTransferService(app.wishlist, app.collection, app.serial, app.covers);
  await assert.rejects(transfer(wish.id, await wishlistRevision(added), purchase), { message: 'RESULT_UNCONFIRMED' });
  await app.changeCover('wishlist', wish.id, await wishlistRevision(added), null);
  const restarted = createCoverStorage(app.directory); await restarted.removeUnreferenced(added.coverId, []);
  assert.ok(await restarted.read(added.coverId, 'image.webp')); assert.equal(attempts, 1);
});
test('confirmed transfer preserves image and initializes favorite; missing storage blocks transfer before append', async t => {
  const app = await setup(t, []);
  const added = await app.changeCover('wishlist', wish.id, await wishlistRevision(wish), bytes);
  await assert.rejects(createTransferService(app.wishlist, app.collection, app.serial)(wish.id, await wishlistRevision(added), purchase), { message: 'COVERS_NOT_CONFIGURED' });
  assert.equal(app.collection.writes.length, 0);
  const result = await createTransferService(app.wishlist, app.collection, app.serial, app.covers)(wish.id, await wishlistRevision(added), purchase);
  assert.equal(result.status, 'complete'); assert.equal(result.collectionRecord.coverId, added.coverId);
  assert.equal(result.collectionRecord.favorite, false); assert.ok(await app.covers.read(added.coverId, 'image.webp'));
  assert.deepEqual(await readdir(join(app.directory, '.holds')), []);
});
test('corrupt hold fails closed; favorite shares queue/version checks and cannot alter metadata', async t => {
  const app = await setup(t);
  const added = await app.changeCover('collection', record.id, await recordRevision(record), bytes);
  await writeFile(join(app.directory, '.holds', 'broken'), '{');
  await app.changeCover('collection', record.id, await recordRevision(added), null);
  assert.ok(await app.covers.read(added.coverId, 'image.webp'));
  const current = (await app.collection.read())[0], version = await recordRevision(current);
  const results = await Promise.allSettled([app.changeFavorite(record.id, version, { favorite: true }), app.changeFavorite(record.id, version, { favorite: false })]);
  assert.deepEqual(results[0].value, { ...current, favorite: true }); assert.equal(results[1].reason.message, 'RECORD_CHANGED');
  await assert.rejects(app.changeFavorite(record.id, version, { favorite: true, note: 'bad' }), { status: 400 });
  assert.throws(() => validateDraft({ ...record }), /COLLECTION_DATA_INVALID/);
  assert.throws(() => validateWishlistDraft({ ...wish }), /WISHLIST_DATA_INVALID/);
});
