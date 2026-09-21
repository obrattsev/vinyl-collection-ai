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
  const server = createApp(createCollectionService(createGoogleSheetsRepository({ spreadsheetId, sheetName, keyFile })));
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
