import { BASE_FIELDS, baseFieldErrors, validateRecords, validateRecordDraft, snapshot, revision } from './base-record.mjs';
import { normalize } from './collection-rules.mjs';
export { UUID } from './base-record.mjs';
export const COLLECTION_FIELDS = Object.freeze([...BASE_FIELDS, 'purchaseDate', 'purchaseStore', 'purchasePrice']);

export class CollectionDataError extends Error {
  constructor() {
    super('COLLECTION_DATA_INVALID');
    this.name = 'CollectionDataError';
  }
}

export function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function draftFieldErrors(record) {
  const errors = baseFieldErrors(record);
  if (record.purchaseStore !== null && (typeof record.purchaseStore !== 'string' || !normalize(record.purchaseStore))) errors.purchaseStore = 'Укажите текст или оставьте поле пустым.';
  if (!(record.purchaseDate === null || isCalendarDate(record.purchaseDate))) errors.purchaseDate = 'Укажите существующую дату YYYY-MM-DD.';
  if (!(record.purchasePrice === null || (typeof record.purchasePrice === 'number' && Number.isFinite(record.purchasePrice) && record.purchasePrice >= 0))) errors.purchasePrice = 'Укажите неотрицательную сумму в рублях.';
  return errors;
}
export const validateCollection = records => validateRecords(records, COLLECTION_FIELDS, draftFieldErrors, CollectionDataError);
export const validateDraft = draft => validateRecordDraft(draft, validateCollection, CollectionDataError);
export const recordSnapshot = record => snapshot(record, COLLECTION_FIELDS);
export const recordRevision = record => revision(record, COLLECTION_FIELDS);
