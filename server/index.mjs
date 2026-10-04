import { backendConfiguration, createPool } from './postgres/config.mjs';
import { createPostgresServices } from './postgres/services.mjs';
import { mirrorConfiguration } from './mirror-sheets.mjs';
import { createStreamingService } from './streaming-service.mjs';
import { reportConfiguration, readRelease, createReportRepository, createReportService } from './bug-reports.mjs';
import { createAuth, authConfiguration } from './auth.mjs';
import { createWishlistRepository } from './google-sheets-wishlist.mjs';
import { createWishlistService } from './wishlist-service.mjs';
import { createTransferService } from './transfer-service.mjs';
import { createWriteQueue } from './record-operations.mjs';
import { createCollectionService } from './collection-service.mjs';
import { isAbsolute } from 'node:path';
import { access } from 'node:fs/promises';
import { createApp } from './app.mjs';
import { createGoogleSheetsRepository } from './google-sheets-collection.mjs';
import { createCoverStorage } from './cover-storage.mjs';
import { createPresentationService } from './presentation-service.mjs';

let postgresPool;
async function start() {
  const backend = backendConfiguration(process.env);
  const mirror = mirrorConfiguration(process.env,backend);
  const { COLLECTION_SPREADSHEET_ID: spreadsheetId, COLLECTION_SHEET_NAME: sheetName,
    GOOGLE_APPLICATION_CREDENTIALS: keyFile, PORT: portValue = '8000' } = process.env;
  if (backend.backend === 'sheets' && (!spreadsheetId || !/^[a-zA-Z0-9_-]+$/.test(spreadsheetId) || !sheetName?.trim() ||
      !keyFile || !isAbsolute(keyFile) || !/^[0-9]+$/.test(portValue) ||
      Number(portValue) < 1 || Number(portValue) > 65535)) throw new Error('Invalid configuration');
  if (!/^[0-9]+$/.test(portValue) || Number(portValue) < 1 || Number(portValue) > 65535) throw Error('Invalid port');
  if (backend.backend === 'sheets') await access(keyFile);
  const auth = createAuth(authConfiguration(process.env));
  let services;
  if (backend.backend === 'postgres') {
    const pool = createPool(backend.url);
    postgresPool = pool;
    const { rows } = await pool.query('SELECT collection_public,wishlist_public FROM vinyl.users WHERE id=$1',[backend.ownerId]);
    if (!rows[0]) throw Error('Configured bridge owner does not exist');
    if (process.env.NODE_ENV==='production') {
      const role=(await pool.query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0];
      if(role.rolsuper||role.rolcreatedb||role.rolcreaterole)throw Error('Unsafe runtime role');
      const privileges=(await pool.query("SELECT has_schema_privilege(current_user,'vinyl','CREATE') AS schema_create,has_database_privilege(current_user,current_database(),'CREATE') AS database_create")).rows[0];
      if(privileges.schema_create||privileges.database_create)throw Error('Runtime must not own schema/database or have CREATE privileges');
    }
    const mirrors=(await pool.query('SELECT user_id FROM vinyl.mirror_state')).rows;
    if(mirrors.some(r=>!mirror||r.user_id!==mirror.ownerId)|| (mirror&&!mirrors.some(r=>r.user_id===mirror.ownerId)))throw Error('Mirror configuration/state mismatch');
    services = createPostgresServices(pool,backend.ownerId,process.env.COVERS_DIR ? createCoverStorage(process.env.COVERS_DIR) : null);
  } else {
    const serial = createWriteQueue();
    const collection = createGoogleSheetsRepository({ spreadsheetId, sheetName, keyFile });
    services = createCollectionService(collection, serial);
    const covers = process.env.COVERS_DIR ? createCoverStorage(process.env.COVERS_DIR) : null;
    let wishlist;
    const { WISHLIST_SPREADSHEET_ID: wishlistId, WISHLIST_SHEET_NAME: wishlistSheet } = process.env;
    if (wishlistId || wishlistSheet) {
      if (!wishlistId || !/^[a-zA-Z0-9_-]+$/.test(wishlistId) || !wishlistSheet?.trim() || wishlistId === spreadsheetId) throw new Error('Invalid wishlist configuration');
      wishlist = createWishlistRepository({ spreadsheetId: wishlistId, sheetName: wishlistSheet, keyFile });
      Object.assign(services, createWishlistService(wishlist, collection, serial), { transferRecord: createTransferService(wishlist, collection, serial, covers) });
    }
    Object.assign(services, createPresentationService({ collection, wishlist, covers, serial }));
  }
  const reportConfig = reportConfiguration(process.env);
  if (reportConfig) { if (!keyFile || !isAbsolute(keyFile)) throw Error('Reports credentials required'); await access(keyFile); }
  if (reportConfig) services.createReport = createReportService(createReportRepository({ ...reportConfig, keyFile }), { version: await readRelease() });
  services.lookupStreaming = createStreamingService();
  const server = createApp(services, { auth });
  server.on('error', async () => {
    await postgresPool?.end();
    console.error('Не удалось запустить сервер. Проверьте доступность локального порта.');
    process.exitCode = 1;
  });
  if (postgresPool) for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => {
    server.close(async () => { await postgresPool.end(); });
    server.closeIdleConnections();
  });
  server.listen(Number(portValue), '127.0.0.1', () => {
    console.log(`Vinyl Collection AI: http://127.0.0.1:${Number(portValue)}/collection`);
  });
}

start().catch(async () => {
  await postgresPool?.end().catch(() => {});
  console.error('Не удалось запустить сервер. Проверьте .env и доступность файла credentials.');
  process.exitCode = 1;
});
