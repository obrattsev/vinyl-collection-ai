import { genresAreDistinct, normalize } from './collection-rules.mjs';

export const COLLECTION_FIELDS = Object.freeze([
  'id', 'artist', 'album', 'genre', 'additionalGenre', 'label', 'albumYear',
  'recordYear', 'editionType', 'note', 'purchaseDate', 'purchaseStore', 'purchasePrice'
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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

// Validate the complete API model without repairing values or changing records.
export function validateCollection(records) {
  if (!Array.isArray(records)) throw new CollectionDataError();
  const ids = new Set();
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record) ||
        Object.keys(record).length !== COLLECTION_FIELDS.length ||
        !COLLECTION_FIELDS.every(field => Object.hasOwn(record, field))) throw new CollectionDataError();
    if (typeof record.id !== 'string' || !UUID.test(record.id) || ids.has(record.id.toLowerCase()) ||
        !nonemptyText(record.artist) || !nonemptyText(record.album) ||
        typeof record.albumYear !== 'string' || !YEAR.test(record.albumYear) ||
        !optionalText.every(field => record[field] === null || nonemptyText(record[field])) ||
        !(record.recordYear === null || (typeof record.recordYear === 'string' && YEAR.test(record.recordYear))) ||
        ![null, 'Оригинал', 'Переиздание'].includes(record.editionType) ||
        !(record.purchaseDate === null || isCalendarDate(record.purchaseDate)) ||
        !(record.purchasePrice === null || (typeof record.purchasePrice === 'number' && Number.isFinite(record.purchasePrice))) ||
        !genresAreDistinct(record)) throw new CollectionDataError();
    ids.add(record.id.toLowerCase());
  }
  return records;
}
