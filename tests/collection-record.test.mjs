import test from 'node:test';
import assert from 'node:assert/strict';
import { CollectionDataError, COLLECTION_FIELDS, isCalendarDate, validateCollection } from '../src/collection-record.mjs';
import { searchCollection } from '../src/collection-rules.mjs';
import { record } from './fixtures/collection.mjs';

test('complete collection records pass without mutations; an empty array is valid', () => {
  const records = Object.freeze([record]);
  assert.equal(validateCollection(records), records);
  assert.deepEqual(validateCollection([]), []);
  assert.equal(COLLECTION_FIELDS.length, 13);
});

test('every applicable key is required; inapplicable or extra keys are rejected', () => {
  for (const field of COLLECTION_FIELDS) {
    const missing = {...record};
    delete missing[field];
    assert.throws(() => validateCollection([missing]), CollectionDataError);
  }
  assert.throws(() => validateCollection([{...record, storeUrl: null}]), CollectionDataError);
});

test('malformed arrays and records are rejected', () => {
  for (const input of [null, undefined, {}, '[]', [null], [[]], [1], [undefined]]) {
    assert.throws(() => validateCollection(input), CollectionDataError);
  }
});

test('UUID is required, canonical and unique regardless of letter case', () => {
  for (const id of [null, undefined, '', ' ', 1, 'not-a-uuid',
    '00000000-0000-0000-0000-000000000000', record.id + ' ']) {
    assert.throws(() => validateCollection([{...record, id}]), CollectionDataError);
  }
  assert.doesNotThrow(() => validateCollection([{...record, id: record.id.toUpperCase()}]));
  assert.throws(() => validateCollection([record, {...record, id: record.id.toUpperCase()}]), CollectionDataError);
});

test('artist and album cannot be absent, nontext or whitespace-only', () => {
  for (const field of ['artist', 'album']) {
    for (const value of [null, undefined, '', ' \t ', 123, false, {}]) {
      assert.throws(() => validateCollection([{...record, [field]: value}]), CollectionDataError);
    }
  }
  const spaced = {...record, artist: '  Art   ROCK  '};
  validateCollection([spaced]);
  assert.equal(spaced.artist, '  Art   ROCK  ');
});

test('optional fields may be null; unknown price differs from free', () => {
  const minimal = Object.fromEntries(COLLECTION_FIELDS.map(field => [field,
    ['id', 'artist', 'album', 'albumYear'].includes(field) ? record[field] : null]));
  assert.doesNotThrow(() => validateCollection([minimal]));
  assert.equal(validateCollection([minimal])[0].purchasePrice, null);
  assert.equal(validateCollection([{...minimal, purchasePrice: 0}])[0].purchasePrice, 0);
  for (const field of ['genre', 'additionalGenre', 'label', 'note', 'purchaseStore']) {
    for (const value of ['', '  ', undefined, 5, false]) {
      assert.throws(() => validateCollection([{...minimal, [field]: value}]), CollectionDataError);
    }
  }
});

test('year fields in CollectionRecord are strings of exactly four digits', () => {
  for (const field of ['albumYear', 'recordYear']) {
    for (const value of [1990, '90', '1990.0', '1990-1991', ' 1990 ', 'abcd']) {
      assert.throws(() => validateCollection([{...record, [field]: value}]), CollectionDataError);
    }
  }
  assert.throws(() => validateCollection([{...record, albumYear: null}]), CollectionDataError);
});

test('purchase dates must be full real calendar dates including leap years', () => {
  for (const date of ['2024-02-29', '2000-02-29', '2026-09-03']) assert.equal(isCalendarDate(date), true);
  for (const date of ['2023-02-29', '1900-02-29', '2026-04-31', '2026-13-01', '2026-00-01',
    '2026-09', '03.09.2026', '2026-09-03T00:00:00Z', 46268, '']) {
    assert.equal(isCalendarDate(date), false);
    assert.throws(() => validateCollection([{...record, purchaseDate: date}]), CollectionDataError);
  }
});

test('prices are finite JSON numbers and edition types follow the agreed enum', () => {
  for (const price of ['4200', '4 200 ₽', NaN, Infinity, -Infinity, false]) {
    assert.throws(() => validateCollection([{...record, purchasePrice: price}]), CollectionDataError);
  }
  assert.doesNotThrow(() => validateCollection([{...record, purchasePrice: 1234.5}]));
  for (const editionType of ['Original', 'Box Set', '', undefined]) {
    assert.throws(() => validateCollection([{...record, editionType}]), CollectionDataError);
  }
});

test('genre distinction reuses case and space normalization', () => {
  assert.throws(() => validateCollection([{...record, genre: ' Art   Rock ', additionalGenre: 'art rock'}]), CollectionDataError);
  assert.doesNotThrow(() => validateCollection([{...record, genre: null}]));
});

test('full API records retain IDs, editions, AND and both genres in existing search', () => {
  const otherEdition = Object.freeze({...record, id: '47ca910b-28f3-451e-a691-83e36a0fc972', recordYear: '1990'});
  const records = Object.freeze([record, otherEdition]);
  validateCollection(records);
  const before = JSON.stringify(records);
  for (const genre of ['rock', 'progressive']) {
    assert.deepEqual(searchCollection(records, {artist: 'орбита', album: 'сигнал', albumYear: '1990', genre}), records);
  }
  assert.deepEqual(searchCollection(records, {artist: 'орбита', albumYear: '2024'}), []);
  assert.deepEqual(searchCollection(records), records);
  assert.equal(JSON.stringify(records), before);
});
