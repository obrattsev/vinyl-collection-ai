import { baseFieldErrors } from './base-record.mjs';
import { coverPresentation, validPublicCover } from './cover-record.mjs';

export const PUBLIC_FIELDS = Object.freeze(['artist', 'album', 'genre', 'additionalGenre', 'label', 'albumYear', 'recordYear', 'editionType', 'note']);
// Call only after full storage-model validation; UUID integrity remains a server concern.
export const publicRecords = records => records.map(record => ({ ...Object.fromEntries(PUBLIC_FIELDS.map(field => [field, record[field]])),
  cover: coverPresentation(record.coverId), ...(Object.hasOwn(record, 'favorite') ? { favorite: record.favorite } : {}) }));
export function validatePublicRecords(records, wishlist) {
  if (!Array.isArray(records) || records.some(record => !record || typeof record !== 'object' || Array.isArray(record) ||
      Object.keys(record).length !== PUBLIC_FIELDS.length + 1 + Number(Object.hasOwn(record, 'favorite')) || !PUBLIC_FIELDS.every(field => Object.hasOwn(record, field)) ||
      !validPublicCover(record.cover) || (Object.hasOwn(record, 'favorite') && typeof record.favorite !== 'boolean') ||
      (wishlist === true && Object.hasOwn(record, 'favorite')) || (wishlist === false && !Object.hasOwn(record, 'favorite')) ||
      Object.keys(baseFieldErrors(record)).length)) throw Error('Invalid public records');
  return records;
}
