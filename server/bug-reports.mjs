import { readFile } from 'node:fs/promises';
import { UUID } from '../src/base-record.mjs';
import { validReport } from '../src/bug-report.mjs';
import { createSheetsRepository } from './google-sheets.mjs';
import { OperationError, createWriteQueue, appendVerified } from './record-operations.mjs';

export const REPORT_COLUMNS = Object.freeze({
  'ID': 'id', 'Создано UTC': 'createdAt', 'Сообщение': 'text', 'Раздел': 'section', 'Версия приложения': 'version'
});
class ReportDataError extends Error {}
class ReportSourceError extends Error {}
export function validateReports(records) {
  const ids = new Set();
  if (!Array.isArray(records)) throw new ReportDataError();
  for (const record of records) {
    if (!record || Object.keys(record).length !== 5 || typeof record.id !== 'string' || !UUID.test(record.id) ||
        ids.has(record.id.toLowerCase()) || !validReport({ text: record.text, section: record.section }) ||
        typeof record.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.createdAt) ||
        !Number.isFinite(Date.parse(record.createdAt)) ||
        !(record.version === null || (typeof record.version === 'string' && /^[a-f0-9]{40}$/.test(record.version)))) throw new ReportDataError();
    ids.add(record.id.toLowerCase());
  }
  return records;
}
export function reportConfiguration(env) {
  const spreadsheetId = env.BUG_REPORT_SPREADSHEET_ID;
  const sheetName = env.BUG_REPORT_SHEET_NAME;
  if (!spreadsheetId && !sheetName) return null;
  if (!spreadsheetId || !/^[a-zA-Z0-9_-]+$/.test(spreadsheetId) || !sheetName?.trim() ||
      [env.COLLECTION_SPREADSHEET_ID, env.WISHLIST_SPREADSHEET_ID].includes(spreadsheetId)) throw Error('Invalid bug report configuration');
  return { spreadsheetId, sheetName };
}
export async function readRelease(path = new URL('../RELEASE', import.meta.url)) {
  try { const value = (await readFile(path, 'utf8')).trim(); return /^[a-f0-9]{40}$/.test(value) ? value : null; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export function createReportRepository(options) {
  const repository = createSheetsRepository({ ...options, columns: REPORT_COLUMNS, validate: validateReports,
    DataError: ReportDataError, SourceError: ReportSourceError });
  return { getRecords: repository.getRecords, appendRecord: repository.appendRecord };
}
const snapshot = record => JSON.stringify(Object.values(REPORT_COLUMNS).map(field => record[field]));
export function createReportService(repository, { version = null, now = () => new Date() } = {}) {
  const serial = createWriteQueue(); let pending = 0;
  const read = async () => validateReports(await repository.getRecords());
  return async input => {
    if (!validReport(input)) throw new OperationError(400, 'INVALID_REPORT');
    if (pending >= 4) throw new OperationError(503, 'REPORT_BUSY');
    pending++;
    try {
      return await serial(async () => {
        let before;
        try { before = await read(); } catch { throw new OperationError(503, 'REPORT_SOURCE_UNAVAILABLE'); }
        const record = await appendVerified(repository, read, { text: input.text, section: input.section,
          createdAt: now().toISOString(), version }, before, snapshot);
        return { id: record.id };
      });
    } finally { pending--; }
  };
}
