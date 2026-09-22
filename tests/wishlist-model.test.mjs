import test from 'node:test';
import assert from 'node:assert/strict';
import { wish, wishDraft } from './fixtures/wishlist.mjs';
import { validateWishlist, validateWishlistDraft, wishlistRevision, WishlistDataError } from '../src/wishlist-record.mjs';
import { searchWishlist } from '../src/wishlist-rules.mjs';
import { WISHLIST_COLUMNS, mapWishlistValues, createWishlistRepository, WishlistSourceError } from '../server/google-sheets-wishlist.mjs';
const headers = Object.keys(WISHLIST_COLUMNS);
const row = Object.values(WISHLIST_COLUMNS).map(field => wish[field]);
test('wishlist maps exactly 11 applicable fields, numeric years, nulls and arbitrary header order', () => {
  assert.deepEqual(mapWishlistValues([headers, row]), [wish]);
  assert.deepEqual(mapWishlistValues([[...headers].reverse(), [...row].reverse()]), [wish]);
  const sparse = [wish.id, 'Artist', 'Album', '', '', '', 2026];
  const [mapped] = mapWishlistValues([headers, sparse]);
  assert.equal(mapped.albumYear, '2026'); assert.equal(mapped.storeUrl, null);
  assert.equal(Object.keys(mapped).length, 11); assert.ok(!Object.hasOwn(mapped, 'purchaseDate'));
  assert.deepEqual(mapWishlistValues([headers, [], ['  ']]), []);
});
test('wishlist rejects missing/duplicate headers, partial rows, malformed URL and invalid UUIDs without repairing', () => {
  for (let i = 0; i < headers.length; i++) {
    assert.throws(() => mapWishlistValues([headers.filter((_, n) => n !== i)]), WishlistDataError);
    assert.throws(() => mapWishlistValues([[...headers, headers[i]]]), WishlistDataError);
  }
  for (const data of [[], [[]], [headers, [wish.id]], [headers, row, row], [[...headers, 'Other'], [...Array(11).fill(''), 'stray']]]) assert.throws(() => mapWishlistValues(data));
  for (const change of [{ id: '' }, { id: 'not-uuid' }, { storeUrl: 'shop without URL' }, { albumYear: 2026 }, { artist: '  ' }, { additionalGenre: wish.genre }]) assert.throws(() => validateWishlist([{ ...wish, ...change }]));
  assert.throws(() => validateWishlist([wish, { ...wish, id: wish.id.toUpperCase() }]));
  assert.deepEqual(validateWishlist([{ ...wish, storeUrl: null }]), [{ ...wish, storeUrl: null }]);
});
test('wishlist draft rejects foreign/missing fields and revisions cover all fields independent of key order', async () => {
  assert.equal(validateWishlistDraft(wishDraft), wishDraft);
  assert.throws(() => validateWishlistDraft(wish));
  assert.throws(() => validateWishlistDraft({ ...wishDraft, purchasePrice: null }));
  for (const field of Object.keys(wishDraft)) { const draft = { ...wishDraft }; delete draft[field]; assert.throws(() => validateWishlistDraft(draft)); }
  const version = await wishlistRevision(wish);
  assert.equal(await wishlistRevision(Object.fromEntries(Object.entries(wish).reverse())), version);
  for (const field of Object.keys(wish)) assert.notEqual(await wishlistRevision({ ...wish, [field]: 'changed' }), version);
});
test('wishlist search uses four automatic criteria, AND and both genres', () => {
  const records = [{ ...wish, artist: 'Some Band', album: 'First Album', albumYear: '2026', genre: 'Rock', additionalGenre: 'Jazz' }];
  for (const criteria of [{artist:'some'}, {album:'album'}, {albumYear:'2026'}, {genre:'rock'}, {genre:'jazz'}, {artist:' SOME  Band ', album:'first', albumYear:'2026', genre:'jazz'}]) {
    assert.deepEqual(searchWishlist(records, criteria), records);
  }
  for (const criteria of [{artist:'other'}, {album:'second'}, {albumYear:'2025'}, {genre:'Blues'}]) {
    assert.deepEqual(searchWishlist(records, {artist:'some', ...criteria}), []);
  }
  assert.deepEqual(searchWishlist(records, {artist:'  ', album:null}), records);
  assert.deepEqual(searchWishlist(records), records);
  for (const albumYear of ['20', '20xx', '20260']) assert.throws(() => searchWishlist([], {albumYear}), /YYYY/);
  // Model-only fields do not become extra manual search criteria.
  assert.deepEqual(searchWishlist(records, {note:'missing', recordYear:'9999', label:'missing', storeUrl:'missing', editionType:'missing'}), records);
});
test('wishlist adapter uses real Sheets contract, typed text writes and UUID deletion', async () => {
  const calls = [];
  const auth = { getClient: async () => ({ request: async request => {
    calls.push(request);
    if (request.url.includes('/values/')) return { data: { values: [headers, row] } };
    return { data: { sheets: [{ properties: { title: 'Wish list', sheetId: 17 } }] } };
  } }) };
  const repository = createWishlistRepository({ spreadsheetId: 'wish-doc', sheetName: 'Wish list', auth });
  assert.deepEqual(await repository.getWishlist(), [wish]);
  await repository.appendRecord({ ...wish, album: '=1+1' });
  await repository.deleteRecord(wish, await wishlistRevision(wish));
  const writes = calls.filter(r => r.method === 'POST');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].data.requests[0].appendCells.rows[0].values[2], { userEnteredValue: { stringValue: '=1+1' } });
  assert.equal(writes[1].data.requests[0].deleteDimension.range.startIndex, 1);
  assert.ok(calls.every(r => r.retry === false && r.timeout === 10000));
});
test('wishlist adapter separates source failures and data errors without leaking details', async () => {
  const repository = createWishlistRepository({ spreadsheetId: 'x', sheetName: 'x', auth: { getClient: async () => { throw Error('credential secret'); } } });
  await assert.rejects(repository.getWishlist(), error => error instanceof WishlistSourceError && !error.message.includes('secret'));
});
