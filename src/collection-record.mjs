import { genresAreDistinct, normalize } from './collection-rules.mjs';

export const COLLECTION_FIELDS = Object.freeze([
  'id', 'artist', 'album', 'genre', 'additionalGenre', 'label', 'albumYear',
  'recordYear', 'editionType', 'note', 'purchaseDate', 'purchaseStore', 'purchasePrice'
]);
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const YEAR = /^[0-9]{4}$/;
const optionalText = ['genre', 'additionalGenre', 'label', 'note', 'purchaseStore'];

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

const nonemptyText = value => typeof value === 'string' && normalize(value) !== '';

// Shared field feedback and validation for both the API model and the form.
export function draftFieldErrors(record) {
  const errors = {};
  for (const field of ['artist', 'album']) {
    if (!nonemptyText(record[field])) errors[field] = 'Заполните обязательное поле.';
  }
  if (typeof record.albumYear !== 'string' || !YEAR.test(record.albumYear)) errors.albumYear = 'Укажите год: четыре цифры YYYY.';
  for (const field of optionalText) {
    if (record[field] !== null && !nonemptyText(record[field])) errors[field] = 'Укажите текст или оставьте поле пустым.';
  }
  if (!(record.recordYear === null || (typeof record.recordYear === 'string' && YEAR.test(record.recordYear)))) errors.recordYear = 'Укажите год: четыре цифры YYYY.';
  if (![null, 'Оригинал', 'Переиздание'].includes(record.editionType)) errors.editionType = 'Выберите допустимый тип издания.';
  if (!(record.purchaseDate === null || isCalendarDate(record.purchaseDate))) errors.purchaseDate = 'Укажите существующую дату YYYY-MM-DD.';
  if (!(record.purchasePrice === null || (typeof record.purchasePrice === 'number' && Number.isFinite(record.purchasePrice) && record.purchasePrice >= 0))) errors.purchasePrice = 'Укажите неотрицательную сумму в рублях.';
  if (!genresAreDistinct(record)) {
    errors.genre = errors.additionalGenre = 'Основной и дополнительный жанры должны различаться.';
  }
  return errors;
}

// Validate the complete API model without repairing values or changing records.
export function validateCollection(records) {
  if (!Array.isArray(records)) throw new CollectionDataError();
  const ids = new Set();
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record) ||
        Object.keys(record).length !== COLLECTION_FIELDS.length ||
        !COLLECTION_FIELDS.every(field => Object.hasOwn(record, field))) throw new CollectionDataError();
    if (typeof record.id !== 'string' || !UUID.test(record.id) || ids.has(record.id.toLowerCase()) ||
        Object.keys(draftFieldErrors(record)).length) throw new CollectionDataError();
    ids.add(record.id.toLowerCase());
  }
  return records;
}

// A draft has all user fields but never a user-assigned ID.
export function validateDraft(draft) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft) || Object.hasOwn(draft, 'id')) throw new CollectionDataError();
  validateCollection([{ ...draft, id: '00000000-0000-4000-8000-000000000001' }]);
  return draft;
}
export const recordSnapshot = record => JSON.stringify(COLLECTION_FIELDS.map(field => record[field]));

export async function recordRevision(record) {
  const bytes = new TextEncoder().encode(recordSnapshot(record));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return '"' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') + '"';
}
