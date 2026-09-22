import { GoogleAuth } from 'google-auth-library';
import { OperationError } from './record-operations.mjs';

const empty = value => value == null || (typeof value === 'string' && value.trim() === '');

function fromCell(field, value, DataError) {
  if (empty(value)) return null;
  if ((field === 'albumYear' || field === 'recordYear') && typeof value === 'number') {
    if (!Number.isInteger(value)) throw new DataError();
    return String(value);
  }
  if (field === 'purchaseDate' && typeof value === 'number') {
    // Sheets serial dates count days from 1899-12-30; a date must not contain a time.
    if (!Number.isInteger(value)) throw new DataError();
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
    if (!Number.isFinite(date.getTime())) throw new DataError();
    return date.toISOString().slice(0, 10);
  }
  return value;
}

export function mapValues(values, { columns: mapping, validate, DataError }) {
  if (!Array.isArray(values) || !Array.isArray(values[0])) throw new DataError();
  const headers = values[0];
  const columns = Object.entries(mapping).map(([header, field]) => {
    const index = headers.indexOf(header);
    if (index < 0 || headers.lastIndexOf(header) !== index) throw new DataError();
    return [index, field];
  });
  const records = [];
  for (const row of values.slice(1)) {
    if (!Array.isArray(row)) throw new DataError();
    if (row.every(empty)) continue;
    records.push(Object.fromEntries(columns.map(([index, field]) => [field, fromCell(field, row[index], DataError)])));
  }
  return validate(records);
}

// Writes use the same mapping/validation and never interpret user text as formulas.
export function createSheetsRepository({ spreadsheetId, sheetName, keyFile, columns, validate, DataError, SourceError, recordRevision,
  auth = new GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/spreadsheets'] }) }) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
  const range = `'${sheetName.replaceAll("'", "''")}'`;
  async function request(options) {
    try { return await (await auth.getClient()).request({ timeout: 10000, retry: false, ...options }); }
    catch { throw new SourceError(); }
  }
  async function read() {
    const response = await request({ url: `${base}/values/${encodeURIComponent(range)}`, method: 'GET',
      params: { majorDimension: 'ROWS', valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' } });
    const values = response?.data?.values;
    return { values, records: mapValues(values, { columns, validate, DataError }) };
  }
  async function sheetId() {
    const response = await request({ url: base, method: 'GET', params: { fields: 'sheets.properties' } });
    const sheet = response.data?.sheets?.find(item => item.properties.title === sheetName);
    if (!Number.isInteger(sheet?.properties.sheetId)) throw new SourceError();
    return sheet.properties.sheetId;
  }
  return {
    getRecords: async () => (await read()).records,
    appendRecord: async record => {
      const targetId = await sheetId();
      const { values } = await read();
      const cells = values[0].map(header => {
        const value = Object.hasOwn(columns, header) ? record[columns[header]] : null;
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
