import { createWishlistRepository } from './google-sheets-wishlist.mjs';
import { createWishlistService } from './wishlist-service.mjs';
import { createTransferService } from './transfer-service.mjs';
import { createWriteQueue } from './record-operations.mjs';
import { createCollectionService } from './collection-service.mjs';
import { isAbsolute } from 'node:path';
import { access } from 'node:fs/promises';
import { createApp } from './app.mjs';
import { createGoogleSheetsRepository } from './google-sheets-collection.mjs';

async function start() {
  const { COLLECTION_SPREADSHEET_ID: spreadsheetId, COLLECTION_SHEET_NAME: sheetName,
    GOOGLE_APPLICATION_CREDENTIALS: keyFile, PORT: portValue = '8000' } = process.env;
  if (!spreadsheetId || !/^[a-zA-Z0-9_-]+$/.test(spreadsheetId) || !sheetName?.trim() ||
      !keyFile || !isAbsolute(keyFile) || !/^[0-9]+$/.test(portValue) ||
      Number(portValue) < 1 || Number(portValue) > 65535) throw new Error('Invalid configuration');
  await access(keyFile);
  const serial = createWriteQueue();
  const collection = createGoogleSheetsRepository({ spreadsheetId, sheetName, keyFile });
  const services = createCollectionService(collection, serial);
  const { WISHLIST_SPREADSHEET_ID: wishlistId, WISHLIST_SHEET_NAME: wishlistSheet } = process.env;
  if (wishlistId || wishlistSheet) {
    if (!wishlistId || !/^[a-zA-Z0-9_-]+$/.test(wishlistId) || !wishlistSheet?.trim() || wishlistId === spreadsheetId) throw new Error('Invalid wishlist configuration');
    const wishlist = createWishlistRepository({ spreadsheetId: wishlistId, sheetName: wishlistSheet, keyFile });
    Object.assign(services, createWishlistService(wishlist, collection, serial), { transferRecord: createTransferService(wishlist, collection, serial) });
  }
  const server = createApp(services);
  server.on('error', () => {
    console.error('Не удалось запустить сервер. Проверьте доступность локального порта.');
    process.exitCode = 1;
  });
  server.listen(Number(portValue), '127.0.0.1', () => {
    console.log(`Vinyl Collection AI: http://127.0.0.1:${Number(portValue)}/prototype/`);
  });
}

start().catch(() => {
  console.error('Не удалось запустить сервер. Проверьте .env и доступность файла credentials.');
  process.exitCode = 1;
});
