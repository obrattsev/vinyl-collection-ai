import { WishlistDataError, validateWishlist, wishlistRevision } from '../src/wishlist-record.mjs';
import { mapValues, createSheetsRepository } from './google-sheets.mjs';
export const WISHLIST_COLUMNS = Object.freeze({
  'ID': 'id', 'Исполнитель': 'artist', 'Альбом': 'album', 'Жанр': 'genre',
  'Дополнительный жанр': 'additionalGenre', 'Лейбл': 'label', 'Год альбома': 'albumYear',
  'Год пластинки': 'recordYear', 'Тип издания': 'editionType', 'Примечание': 'note', 'Ссылка на онлайн-магазин': 'storeUrl'
});
export class WishlistSourceError extends Error {
  constructor() { super('WISHLIST_SOURCE_UNAVAILABLE'); this.name = 'WishlistSourceError'; }
}
const model = { columns: WISHLIST_COLUMNS, validate: validateWishlist, DataError: WishlistDataError, SourceError: WishlistSourceError, recordRevision: wishlistRevision };
export const mapWishlistValues = values => mapValues(values, model);
export function createWishlistRepository(options) {
  const repository = createSheetsRepository({ ...options, ...model });
  return { ...repository, getWishlist: repository.getRecords };
}
