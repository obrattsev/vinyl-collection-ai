import { baseFieldErrors } from './base-record.mjs';

export const PUBLIC_FIELDS = Object.freeze(['artist', 'album', 'genre', 'additionalGenre', 'label', 'albumYear', 'recordYear', 'editionType', 'note']);
// Call only after full storage-model validation; UUID integrity remains a server concern.
export const publicRecords = records => records.map(record => Object.fromEntries(PUBLIC_FIELDS.map(field => [field, record[field]])));
export function validatePublicRecords(records) {
  if (!Array.isArray(records) || records.some(record => !record || typeof record !== 'object' || Array.isArray(record) ||
      Object.keys(record).length !== PUBLIC_FIELDS.length || !PUBLIC_FIELDS.every(field => Object.hasOwn(record, field)) ||
      Object.keys(baseFieldErrors(record)).length)) throw Error('Invalid public records');
  return records;
}
