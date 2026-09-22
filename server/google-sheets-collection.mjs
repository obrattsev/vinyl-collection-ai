import { GoogleAuth } from 'google-auth-library';
import { CollectionDataError, validateCollection, recordRevision } from '../src/collection-record.mjs';
import { mapValues, createSheetsRepository } from './google-sheets.mjs';

export const SHEETS_COLUMNS = Object.freeze({
  'ID': 'id', 'Исполнитель': 'artist', 'Альбом': 'album', 'Жанр': 'genre',
  'Дополнительный жанр': 'additionalGenre', 'Лейбл': 'label', 'Год альбома': 'albumYear',
  'Год пластинки': 'recordYear', 'Тип издания': 'editionType', 'Примечание': 'note',
  'Дата покупки': 'purchaseDate', 'Магазин покупки': 'purchaseStore', 'Цена покупки': 'purchasePrice'
});
export const READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

export class CollectionSourceError extends Error {
  constructor() {
    super('COLLECTION_SOURCE_UNAVAILABLE');
    this.name = 'CollectionSourceError';
  }
}

const model = { columns: SHEETS_COLUMNS, validate: validateCollection, DataError: CollectionDataError, SourceError: CollectionSourceError, recordRevision };
export const mapSheetValues = values => mapValues(values, model);
export function createGoogleSheetsRepository(options) {
  const repository = createSheetsRepository({ ...options, ...model });
  return { ...repository, getCollection: repository.getRecords };
}
export function createGoogleSheetsCollection({ spreadsheetId, sheetName, keyFile,
  auth = new GoogleAuth({ keyFile, scopes: [READONLY_SCOPE] }) }) {
  return createGoogleSheetsRepository({ spreadsheetId, sheetName, keyFile, auth }).getCollection;
}
