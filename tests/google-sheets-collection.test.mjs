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

test('writes append typed cells after data, map reordered headers and delete only the UUID row', async () => {
  const { createGoogleSheetsRepository } = await import('../server/google-sheets-collection.mjs');
  const { createCollectionService } = await import('../server/collection-service.mjs');
  const { recordRevision } = await import('../src/collection-record.mjs');
  const reversedHeaders = [...headers].reverse().concat('Other');
  const originalRow = [...row].reverse().concat('preserve');
  const values = [reversedHeaders, [], originalRow];
  const mutations = [];
  const auth = { getClient: async () => ({ request: async options => {
    assert.equal(options.retry, false);
    if (options.method === 'GET') {
      if (options.url.includes('/values/')) return { data: { values: structuredClone(values) } };
      return { data: { sheets: [{ properties: { title: 'Collection', sheetId: 27 } }] } };
    }
    assert.equal(options.method, 'POST'); assert.ok(options.url.endsWith(':batchUpdate'));
    const mutation = options.data.requests[0]; mutations.push(mutation);
    if (mutation.appendCells) {
      const append = mutation.appendCells;
      assert.equal(append.sheetId, 27); assert.equal(append.fields, 'userEnteredValue');
      assert.equal(append.rows.length, 1);
      const cells = append.rows[0].values;
      assert.ok(cells.every(cell => !cell.userEnteredValue || !Object.hasOwn(cell.userEnteredValue, 'formulaValue')));
      values.push(cells.map(cell => cell.userEnteredValue?.stringValue ?? cell.userEnteredValue?.numberValue ?? ''));
    } else {
      const range = mutation.deleteDimension.range;
      assert.deepEqual(range, { sheetId: 27, dimension: 'ROWS', startIndex: 3, endIndex: 4 });
      values.splice(range.startIndex, 1);
    }
    return { data: {} };
  } }) };
  const service = createCollectionService(createGoogleSheetsRepository({ spreadsheetId: 'test', sheetName: 'Collection', auth }));
  const { id, ...input } = record;
  input.album = '=literal title'; input.purchasePrice = 0; input.note = null;
  const created = await service.createRecord(input);
  assert.deepEqual(created, { ...input, id: created.id });
  assert.deepEqual(values[2], originalRow);
  assert.deepEqual(await service.deleteRecord(created.id, await recordRevision(created)), created);
  assert.deepEqual(values, [reversedHeaders, [], originalRow]);
  assert.equal(mutations.length, 2);
});

test('adapter resolves moved UUID immediately before deletion and rejects a changed or missing target', async () => {
  const { createGoogleSheetsRepository } = await import('../server/google-sheets-collection.mjs');
  const { recordRevision } = await import('../src/collection-record.mjs');
  let values = [headers, [], [], row]; let mutation;
  const auth = { getClient: async () => ({ request: async options => {
    if (options.url.includes('/values/')) return { data: { values } };
    if (options.method === 'GET') return { data: { sheets: [{ properties: { title: 'Collection', sheetId: 0 } }] } };
    mutation = options.data; return { data: {} };
  } }) };
  const repo = createGoogleSheetsRepository({ spreadsheetId: 'test', sheetName: 'Collection', auth });
  const revision = await recordRevision(record);
  await repo.deleteRecord(record, revision);
  assert.equal(mutation.requests[0].deleteDimension.range.startIndex, 3);
  mutation = null;
  values = [headers, row.map((v, i) => i === 9 ? 'changed externally' : v)];
  await assert.rejects(repo.deleteRecord(record, revision), error => error.status === 409 && error.message === 'RECORD_CHANGED');
  values = [headers];
  await assert.rejects(repo.deleteRecord(record, revision), error => error.status === 404);
  assert.equal(mutation, null);
});

test('adapter never writes when sheet metadata or existing data are invalid', async () => {
  const { createGoogleSheetsRepository } = await import('../server/google-sheets-collection.mjs');
  for (const metadata of [true, false]) {
    let writes = 0;
    const auth = { getClient: async () => ({ request: async options => {
      if (options.method !== 'GET') writes++;
      if (options.url.includes('/values/')) return { data: { values: [headers, ['bad']] } };
      return { data: { sheets: metadata ? [{ properties: { title: 'Collection', sheetId: 1 } }] : [] } };
    } }) };
    const repo = createGoogleSheetsRepository({ spreadsheetId: 'test', sheetName: 'Collection', auth });
    await assert.rejects(repo.appendRecord(record), metadata ? CollectionDataError : CollectionSourceError);
    assert.equal(writes, 0);
  }
});
