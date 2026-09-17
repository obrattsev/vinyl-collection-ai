import { GoogleAuth } from 'google-auth-library';
import { CollectionDataError, validateCollection } from '../src/collection-record.mjs';

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
  const range = `'${sheetName.replaceAll("'", "''")}'`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
  return async function getCollection() {
    let response;
    try {
      const client = await auth.getClient();
      response = await client.request({
        url, method: 'GET', timeout: 10000, retry: false,
        params: { majorDimension: 'ROWS', valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' }
      });
    } catch {
      // Google exceptions can contain request headers/tokens. Never propagate them.
      throw new CollectionSourceError();
    }
    return mapSheetValues(response?.data?.values);
  };
}
