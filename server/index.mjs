import { statisticsConfiguration, createStatistics } from './statistics.mjs';
import { createMultiUserAuth } from './security/http-auth.mjs';
import { createEmailService } from './security/email.mjs';
import { createDurableReportService, reportNotificationConfiguration, reportPage, startReportDelivery } from './report-delivery.mjs';
import { scopedServices } from './security/scoped-services.mjs';
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
let reportWorker;
async function start() {
  let authMail,reportDelivery,statistics;
  const statisticsConfig=statisticsConfiguration(process.env);
  const backend = backendConfiguration(process.env);
  const mirror = mirrorConfiguration(process.env,backend);
  const { COLLECTION_SPREADSHEET_ID: spreadsheetId, COLLECTION_SHEET_NAME: sheetName,
    GOOGLE_APPLICATION_CREDENTIALS: keyFile, PORT: portValue = '8000' } = process.env;
  if (backend.backend === 'sheets' && (!spreadsheetId || !/^[a-zA-Z0-9_-]+$/.test(spreadsheetId) || !sheetName?.trim() ||
      !keyFile || !isAbsolute(keyFile) || !/^[0-9]+$/.test(portValue) ||
      Number(portValue) < 1 || Number(portValue) > 65535)) throw new Error('Invalid configuration');
  if (!/^[0-9]+$/.test(portValue) || Number(portValue) < 1 || Number(portValue) > 65535) throw Error('Invalid port');
  if (backend.backend === 'sheets') await access(keyFile);
  if (process.env.AUTH_MODE && !['legacy','multiuser'].includes(process.env.AUTH_MODE)) throw Error('Invalid AUTH_MODE');
  if (process.env.AUTH_MODE==='multiuser' && backend.backend!=='postgres') throw Error('Multi-user auth requires PostgreSQL');
  let auth = process.env.AUTH_MODE==='multiuser' ? null : createAuth(authConfiguration(process.env));
  let servicesForSession;
  let services;
  if (backend.backend === 'postgres') {
    const pool = createPool(backend.url);
    postgresPool = pool;
    if(statisticsConfig)statistics=createStatistics(pool);
    const { rows } = await pool.query('SELECT collection_public,wishlist_public FROM vinyl.users WHERE id=$1',[backend.ownerId]);
    if (!rows[0]) throw Error('Configured bridge owner does not exist');
    if (process.env.NODE_ENV==='production') {
      const authSchema=(await pool.query("SELECT to_regclass('vinyl.user_auth') AS name")).rows[0].name;
      if(authSchema && process.env.AUTH_MODE!=='multiuser')throw Error('Auth database cannot bypass multiuser safety gates');
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
  if (process.env.AUTH_MODE==='multiuser') {
    authMail=createEmailService(process.env);
    auth=await createMultiUserAuth({pool:postgresPool,env:process.env,ownerId:backend.ownerId,covers:services.coverStorage,emailService:authMail,statistics});
    await auth.accounts.cleanup().catch(()=>console.warn('Pending account cover cleanup; retry after restart.'));
    servicesForSession=scopedServices(postgresPool,backend.ownerId,services.coverStorage,statistics);
    const cleanup=setInterval(()=>auth.store.cleanup().catch(()=>console.error('Auth cleanup unavailable')),60000);
    cleanup.unref();
    await auth.store.cleanup();
  }
  const reportConfig = reportConfiguration(process.env);
  const notifications=reportNotificationConfiguration(process.env);
  if(notifications && (!reportConfig || !postgresPool || !authMail)) throw Error('Report notifications require multiuser PostgreSQL reports');
  if (reportConfig) { if (!keyFile || !isAbsolute(keyFile)) throw Error('Reports credentials required'); await access(keyFile); }
  if (reportConfig) {
    const repository=createReportRepository({...reportConfig,keyFile}),version=await readRelease();
    if(postgresPool && authMail) {
      await postgresPool.query('SELECT id FROM vinyl.bug_report_deliveries LIMIT 0');
      reportDelivery=createDurableReportService(postgresPool,{repository,mail:authMail,recipient:notifications?.recipient,version});
      services.createReport=reportDelivery.create;
    } else {
      const legacy=createReportService(repository,{version});
      services.createReport=input=>{
        if(input && Object.hasOwn(input,'page')){const {page,...record}=input;reportPage(page);return legacy(record);}
        return legacy(input);
      };
    }
  }
  await statistics?.initialize();
  services.lookupStreaming = createStreamingService();
  const server = createApp(services, { auth, servicesForSession, onListView:statistics?.view });
  server.on('error', async () => {
    await reportWorker?.close();
    await postgresPool?.end();
    console.error('Не удалось запустить сервер. Проверьте доступность локального порта.');
    process.exitCode = 1;
  });
  if (postgresPool) for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => {
    server.close(async () => { await reportWorker?.close(); await postgresPool.end(); });
    server.closeIdleConnections();
  });
  server.listen(Number(portValue), '127.0.0.1', () => {
    if(reportDelivery)reportWorker=startReportDelivery(reportDelivery,{onError:code=>console.error(code)});
    console.log(`Vinyl Collection AI: http://127.0.0.1:${Number(portValue)}/collection`);
  });
}

start().catch(async () => {
  await reportWorker?.close();
  await postgresPool?.end().catch(() => {});
  console.error('Не удалось запустить сервер. Проверьте .env и доступность файла credentials.');
  process.exitCode = 1;
});
