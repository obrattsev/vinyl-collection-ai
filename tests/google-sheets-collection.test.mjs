import test from 'node:test';
import assert from 'node:assert/strict';
import { SHEETS_COLUMNS, READONLY_SCOPE, CollectionSourceError, createGoogleSheetsCollection, mapSheetValues } from '../server/google-sheets-collection.mjs';
import { CollectionDataError } from '../src/collection-record.mjs';
import { record } from './fixtures/collection.mjs';

const headers = Object.keys(SHEETS_COLUMNS);
const row = Object.values(SHEETS_COLUMNS).map(field => record[field]);

test('all 13 Russian columns map to the agreed complete model without changing input', () => {
  const values = Object.freeze([Object.freeze([...headers]), Object.freeze([...row])]);
  assert.deepEqual(mapSheetValues(values), [record]);
  assert.equal(Object.hasOwn(mapSheetValues(values)[0], 'storeUrl'), false);
});

test('header order is arbitrary and unknown columns do not enter the model', () => {
  const input = [[...headers].reverse().concat('Неизвестная колонка'), [...row].reverse().concat('ignored')];
  assert.deepEqual(mapSheetValues(input), [record]);
});

test('missing or repeated expected headings fail, even for optional fields and empty data', () => {
  for (let i = 0; i < headers.length; i++) {
    assert.throws(() => mapSheetValues([headers.filter((_, index) => index !== i)]), CollectionDataError);
    assert.throws(() => mapSheetValues([[...headers, headers[i]]]), CollectionDataError);
  }
  assert.throws(() => mapSheetValues([headers.map(h => h === 'Примечание' ? 'Комментарий' : h)]), CollectionDataError);
});

test('a header-only collection and entirely blank rows produce an empty collection', () => {
  assert.deepEqual(mapSheetValues([headers]), []);
  assert.deepEqual(mapSheetValues([headers, [], ['', null, '  ', undefined]]), []);
  assert.deepEqual(mapSheetValues([headers, [], row, []]), [record]);
});

test('a missing header row is invalid, not an empty collection', () => {
  for (const values of [undefined, null, {}, [], [[]], ['not-a-row']]) {
    assert.throws(() => mapSheetValues(values), CollectionDataError);
  }
});

test('partial rows are validated, including rows populated only in unknown columns', () => {
  for (const partial of [[record.id], [null, 'Artist'], null, 'row']) {
    assert.throws(() => mapSheetValues([headers, partial]), CollectionDataError);
  }
  assert.throws(() => mapSheetValues([[...headers, 'Other'], [...Array(13).fill(''), 'value']]), CollectionDataError);
});

test('empty and omitted optional cells become null without losing numeric zero', () => {
  const sparse = [record.id, record.artist, record.album, '', '   ', null, '1990'];
  const mapped = mapSheetValues([headers, sparse])[0];
  for (const field of ['genre', 'additionalGenre', 'label', 'recordYear', 'editionType', 'note', 'purchaseDate', 'purchaseStore', 'purchasePrice']) {
    assert.equal(mapped[field], null);
  }
  const free = [...row]; free[12] = 0;
  assert.equal(mapSheetValues([headers, free])[0].purchasePrice, 0);
});

test('numeric years map to YYYY strings without truncation or padding', () => {
  const numeric = [...row]; numeric[6] = 1990; numeric[7] = 2024;
  assert.deepEqual(mapSheetValues([headers, numeric]), [record]);
  for (const year of [90, 1990.5, NaN, Infinity]) {
    assert.throws(() => mapSheetValues([headers, row.map((v, i) => i === 6 ? year : v)]), CollectionDataError);
  }
});

test('Sheets serial dates become ISO dates without timezone shifts or accepting times', () => {
  const serial = (Date.UTC(2024, 1, 29) - Date.UTC(1899, 11, 30)) / 86400000;
  assert.equal(mapSheetValues([headers, row.map((v, i) => i === 10 ? serial : v)])[0].purchaseDate, '2024-02-29');
  for (const value of [serial + 0.5, Infinity, '29.02.2024', '2023-02-29']) {
    assert.throws(() => mapSheetValues([headers, row.map((v, i) => i === 10 ? value : v)]), CollectionDataError);
  }
});

test('duplicate IDs and an invalid record reject the whole collection', () => {
  assert.throws(() => mapSheetValues([headers, row, row]), CollectionDataError);
  const invalid = [...row]; invalid[0] = 'invalid';
  assert.throws(() => mapSheetValues([headers, row, invalid]), CollectionDataError);
});

test('the adapter only issues a GET with unformatted values and escaped sheet name', async () => {
  let calls = 0;
  const auth = {getClient: async () => ({request: async options => {
    calls++;
    assert.equal(options.method, 'GET');
    assert.equal(options.url, "https://sheets.googleapis.com/v4/spreadsheets/test-id/values/'O''Brien%20Collection'");
    assert.deepEqual(options.params, {majorDimension: 'ROWS', valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER'});
    assert.equal(options.retry, false);
    assert.equal(options.timeout, 10000);
    return {data: {values: [headers, row]}};
  }})};
  const getCollection = createGoogleSheetsCollection({spreadsheetId:'test-id', sheetName:"O'Brien Collection", auth});
  assert.deepEqual(await getCollection(), [record]);
  assert.equal(calls, 1);
  assert.equal(READONLY_SCOPE, 'https://www.googleapis.com/auth/spreadsheets.readonly');
});

test('authentication and Google request errors are sanitized and distinct from invalid data', async () => {
  for (const auth of [
    {getClient: async () => {throw new Error('private-key-token');}},
    {getClient: async () => ({request: async () => {throw new Error('private-key-token');}})}
  ]) {
    const get = createGoogleSheetsCollection({spreadsheetId:'test', sheetName:'Collection', auth});
    await assert.rejects(get(), error => error instanceof CollectionSourceError && error.message === 'COLLECTION_SOURCE_UNAVAILABLE' && error.cause === undefined);
  }
  const auth = {getClient: async () => ({request: async () => ({data:{}})})};
  await assert.rejects(createGoogleSheetsCollection({spreadsheetId:'test', sheetName:'Collection', auth})(), CollectionDataError);
});
