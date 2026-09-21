import { OperationError } from './collection-service.mjs';
import { GoogleAuth } from 'google-auth-library';
import { CollectionDataError, validateCollection, recordRevision } from '../src/collection-record.mjs';

export const SHEETS_COLUMNS = Object.freeze({
  'ID': 'id', 'Исполнитель': 'artist', 'Альбом': 'album', 'Жанр': 'genre',
  'Дополнительный жанр': 'additionalGenre', 'Лейбл': 'label', 'Год альбома': 'albumYear',
  'Год пластинки': 'recordYear', 'Тип издания': 'editionType', 'Примечание': 'note',
  'Дата покупки': 'purchaseDate', 'Магазин покупки': 'purchaseStore', 'Цена покупки': 'purchasePrice'
});
export const READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

export class CollectionSourceError extends Error {
  constructor() {
    super('COLLECTION_SOURCE_UNAVAILABLE');
    this.name = 'CollectionSourceError';
  }
}

const empty = value => value == null || (typeof value === 'string' && value.trim() === '');

function fromCell(field, value) {
  if (empty(value)) return null;
  if ((field === 'albumYear' || field === 'recordYear') && typeof value === 'number') {
    if (!Number.isInteger(value)) throw new CollectionDataError();
    return String(value);
  }
  if (field === 'purchaseDate' && typeof value === 'number') {
    // Sheets serial dates count days from 1899-12-30; a date must not contain a time.
    if (!Number.isInteger(value)) throw new CollectionDataError();
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    if (!Number.isFinite(date.getTime())) throw new CollectionDataError();
    return date.toISOString().slice(0, 10);
  }
  return value;
}

export function mapSheetValues(values) {
  if (!Array.isArray(values) || !Array.isArray(values[0])) throw new CollectionDataError();
  const headers = values[0];
  const columns = Object.entries(SHEETS_COLUMNS).map(([header, field]) => {
    const index = headers.indexOf(header);
    if (index < 0 || headers.lastIndexOf(header) !== index) throw new CollectionDataError();
    return [index, field];
  });
  const records = [];
  for (const row of values.slice(1)) {
    if (!Array.isArray(row)) throw new CollectionDataError();
    if (row.every(empty)) continue;
    records.push(Object.fromEntries(columns.map(([index, field]) => [field, fromCell(field, row[index])])));
  }
  return validateCollection(records);
}

export function createGoogleSheetsCollection({ spreadsheetId, sheetName, keyFile,
  auth = new GoogleAuth({ keyFile, scopes: [READONLY_SCOPE] }) }) {
  return createGoogleSheetsRepository({ spreadsheetId, sheetName, keyFile, auth }).getCollection;
}

// Writes use the same mapping/validation and never interpret user text as formulas.
export function createGoogleSheetsRepository({ spreadsheetId, sheetName, keyFile,
  auth = new GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }) }) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
  const range = `'${sheetName.replaceAll("'", "''")}'`;
  async function request(options) {
    try { return await (await auth.getClient()).request({ timeout: 10000, retry: false, ...options }); }
    catch { throw new CollectionSourceError(); }
  }
  async function read() {
    const response = await request({ url: `${base}/values/${encodeURIComponent(range)}`, method: 'GET',
      params: { majorDimension: 'ROWS', valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' } });
    const values = response?.data?.values;
    return { values, records: mapSheetValues(values) };
  }
  async function sheetId() {
    const response = await request({ url: base, method: 'GET', params: { fields: 'sheets.properties' } });
    const sheet = response.data?.sheets?.find(item => item.properties.title === sheetName);
    if (!Number.isInteger(sheet?.properties.sheetId)) throw new CollectionSourceError();
    return sheet.properties.sheetId;
  }
  return {
    getCollection: async () => (await read()).records,
    appendRecord: async record => {
      const targetId = await sheetId();
      const { values } = await read();
      const cells = values[0].map(header => {
        const value = Object.hasOwn(SHEETS_COLUMNS, header) ? record[SHEETS_COLUMNS[header]] : null;
        return value == null ? {} : { userEnteredValue:
          typeof value === 'number' ? { numberValue: value } : { stringValue: value } };
      });
      // appendCells uses the last data row, including data below blank rows, without overwriting rows.
      await request({ url: `${base}:batchUpdate`, method: 'POST', data: { requests: [{ appendCells: {
        sheetId: targetId, rows: [{ values: cells }], fields: 'userEnteredValue'
      } }] } });
    },
    deleteRecord: async (record, expected) => {
      const targetId = await sheetId();
      const { values, records } = await read();
      const current = records.find(r => r.id.toLowerCase() === record.id.toLowerCase());
      if (!current) throw new OperationError(404, 'NOT_FOUND');
      if (await recordRevision(current) !== expected) throw new OperationError(409, 'RECORD_CHANGED', { record: current });
      const column = values[0].indexOf('ID');
      const index = values.findIndex((row, i) => i > 0 && typeof row[column] === 'string' && row[column].toLowerCase() === record.id.toLowerCase());
      await request({ url: `${base}:batchUpdate`, method: 'POST', data: { requests: [{ deleteDimension: {
        range: { sheetId: targetId, dimension: 'ROWS', startIndex: index, endIndex: index + 1 }
      } }] } });
    }
  };
}
