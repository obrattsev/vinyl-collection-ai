import { genresAreDistinct, normalize } from './collection-rules.mjs';

export const BASE_FIELDS = Object.freeze(['id', 'artist', 'album', 'genre', 'additionalGenre', 'label', 'albumYear', 'recordYear', 'editionType', 'note']);
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const YEAR = /^[0-9]{4}$/;
const optionalText = ['genre', 'additionalGenre', 'label', 'note'];

const nonemptyText = value => typeof value === 'string' && normalize(value) !== '';

export function baseFieldErrors(record) {
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
  if (!genresAreDistinct(record)) {
    errors.genre = errors.additionalGenre = 'Основной и дополнительный жанры должны различаться.';
  }
  return errors;
}

export function validateRecords(records, fields, fieldErrors, DataError) {
  if (!Array.isArray(records)) throw new DataError();
  const ids = new Set();
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record) ||
        Object.keys(record).length !== fields.length || !fields.every(field => Object.hasOwn(record, field)) ||
        typeof record.id !== 'string' || !UUID.test(record.id) || ids.has(record.id.toLowerCase()) ||
        Object.keys(fieldErrors(record)).length) throw new DataError();
    ids.add(record.id.toLowerCase());
  }
  return records;
}
export function validateRecordDraft(draft, validate, DataError) {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft) || Object.hasOwn(draft, 'id')) throw new DataError();
  validate([{ ...draft, id: '00000000-0000-4000-8000-000000000001' }]);
  return draft;
}
export const snapshot = (record, fields) => JSON.stringify(fields.map(field => record[field]));
export async function revision(record, fields) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot(record, fields)));
  return '"' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') + '"';
}
