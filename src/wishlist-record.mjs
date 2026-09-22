import { BASE_FIELDS, baseFieldErrors, validateRecords, validateRecordDraft, snapshot, revision } from './base-record.mjs';
export const WISHLIST_FIELDS = Object.freeze([...BASE_FIELDS, 'storeUrl']);
export class WishlistDataError extends Error {
  constructor() { super('WISHLIST_DATA_INVALID'); this.name = 'WishlistDataError'; }
}
export function validStoreUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try { new URL(value); return true; } catch { return false; }
}
export function wishlistFieldErrors(record) {
  const errors = baseFieldErrors(record);
  if (record.storeUrl !== null && !validStoreUrl(record.storeUrl)) errors.storeUrl = 'Укажите полный URL или оставьте поле пустым.';
  return errors;
}
export const validateWishlist = records => validateRecords(records, WISHLIST_FIELDS, wishlistFieldErrors, WishlistDataError);
export const validateWishlistDraft = draft => validateRecordDraft(draft, validateWishlist, WishlistDataError);
export const wishlistSnapshot = record => snapshot(record, WISHLIST_FIELDS);
export const wishlistRevision = record => revision(record, WISHLIST_FIELDS);
