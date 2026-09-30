import { publicRecords } from '../src/public-record.mjs';
import { OperationError } from './collection-service.mjs';
import { WishlistDataError, validateWishlist } from '../src/wishlist-record.mjs';
import { WishlistSourceError } from './google-sheets-wishlist.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { CollectionDataError, validateCollection } from '../src/collection-record.mjs';
import { CollectionSourceError } from './google-sheets-collection.mjs';
import { COVER_MAX_BYTES } from './cover-storage.mjs';
import { UUID } from '../src/base-record.mjs';

// No user-controlled filesystem paths, directory listing, or repository-wide serving.
const clientFiles = new Map([
  ['/src/cover-record.mjs', ['../src/cover-record.mjs', 'text/javascript; charset=utf-8']],
  ['/src/daily-quote.mjs', ['../src/daily-quote.mjs', 'text/javascript; charset=utf-8']],
  ['/assets/cover-ui.mjs', ['../prototype/cover-ui.mjs', 'text/javascript; charset=utf-8']],
  ['/assets/daily-quote-ui.mjs', ['../prototype/daily-quote-ui.mjs', 'text/javascript; charset=utf-8']],
  ['/assets/data/music-quotes.json', ['../prototype/data/music-quotes.json', 'application/json; charset=utf-8']],
  ['/assets/mobile-records.mjs', ['../prototype/mobile-records.mjs', 'text/javascript; charset=utf-8']],
  ['/src/bug-report.mjs', ['../src/bug-report.mjs', 'text/javascript; charset=utf-8']],
  ['/assets/bug-report-ui.mjs', ['../prototype/bug-report-ui.mjs', 'text/javascript; charset=utf-8']],
  ['/assets/record-presentation.mjs', ['../prototype/record-presentation.mjs', 'text/javascript; charset=utf-8']],
  ['/src/public-record.mjs', ['../src/public-record.mjs', 'text/javascript; charset=utf-8']],
  ['/wishlist', ['../prototype/wishlist.html', 'text/html; charset=utf-8']],
  ['/src/base-record.mjs', ['../src/base-record.mjs', 'text/javascript; charset=utf-8']],
  ['/src/wishlist-record.mjs', ['../src/wishlist-record.mjs', 'text/javascript; charset=utf-8']],
  ['/src/wishlist-rules.mjs', ['../src/wishlist-rules.mjs', 'text/javascript; charset=utf-8']],
  ['/collection', ['../prototype/index.html', 'text/html; charset=utf-8']],
  ['/assets/styles.css', ['../prototype/styles.css', 'text/css; charset=utf-8']],
  ['/assets/app.js', ['../prototype/app.js', 'text/javascript; charset=utf-8']],
  ['/assets/input-controls.mjs', ['../prototype/input-controls.mjs', 'text/javascript; charset=utf-8']],
  ['/src/genres.mjs', ['../src/genres.mjs', 'text/javascript; charset=utf-8']],
  ['/src/collection-record.mjs', ['../src/collection-record.mjs', 'text/javascript; charset=utf-8']],
  ['/src/collection-rules.mjs', ['../src/collection-rules.mjs', 'text/javascript; charset=utf-8']]
]);

// Only known page aliases redirect; unknown paths remain 404.
const pageAliases = new Map([
  ['', '/collection'],
  ['/collection', '/collection'],
  ['/wishlist', '/wishlist'],
  ['/prototype', '/collection'],
  ['/prototype/index.html', '/collection'],
  ['/prototype/wishlist.html', '/wishlist']
]);

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function createApp({ getCollection, createRecord, deleteRecord, updateRecord, getWishlist, createWishlistRecord, deleteWishlistRecord, updateWishlistRecord, transferRecord, createReport, coverStorage, changeCover, changeFavorite }, { auth, quoteSource } = {}) {
  let coverUploading = false;
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('Referrer-Policy', 'same-origin');
    const path = req.url.split('?')[0];
    try {
      const session = auth?.session(req);
      const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      if (unsafe) {
        if (!auth) throw new OperationError(401, 'AUTH_REQUIRED');
        auth.checkOrigin(req);
      }
      if (path.startsWith('/api/auth/')) {
        if (!auth) throw new OperationError(503, 'AUTH_UNAVAILABLE');
        if (path === '/api/auth/session' && req.method === 'GET') {
          if (!session) auth.limit(req, 'read', res);
          json(res, 200, auth.describe(session)); return;
        }
        if (path === '/api/auth/login' && req.method === 'POST') {
          auth.limit(req, 'login', res);
          json(res, 200, await auth.login(req, res, await readBody(req))); return;
        }
        if (path === '/api/auth/logout' && req.method === 'POST') {
          auth.requireOwner(req, session);
          json(res, 200, auth.logout(req, res)); return;
        }
        const allowed = { '/api/auth/session': 'GET', '/api/auth/login': 'POST', '/api/auth/logout': 'POST' }[path];
        if (allowed) { res.setHeader('Allow', allowed); json(res, 405, { error: 'METHOD_NOT_ALLOWED' }); }
        else json(res, 404, { error: 'NOT_FOUND' });
        return;
      }
      if (path === '/api/bug-reports') {
        if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); json(res, 405, { error: 'METHOD_NOT_ALLOWED' }); return; }
        auth.limit(req, 'report', res);
        if (!createReport) throw new OperationError(503, 'REPORT_NOT_CONFIGURED');
        json(res, 201, await createReport(await readBody(req, 16384))); return;
      }
      if (unsafe) auth.requireOwner(req, session);
      if (req.method === 'GET' && path.startsWith('/api/') && !session) auth?.limit(req, 'read', res);
      const visible = records => session ? records : publicRecords(records);
      res.setHeader('X-Access-Role', session ? 'owner' : 'guest');
      const media = path.match(/^\/media\/covers\/([^/]+)\/(thumb\.webp|image\.webp)$/);
      if (media && ['GET', 'HEAD'].includes(req.method)) {
        if (!coverStorage || !UUID.test(media[1])) throw new OperationError(404, 'NOT_FOUND');
        const bytes = await coverStorage.read(media[1], media[2]);
        res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': bytes.length });
        res.end(req.method === 'HEAD' ? undefined : bytes); return;
      }
      const cover = path.match(/^\/api\/(collection|wishlist)\/([^/]+)\/cover$/);
      if (cover) {
        if (!['PUT', 'DELETE'].includes(req.method)) { res.setHeader('Allow', 'PUT, DELETE'); throw new OperationError(405, 'METHOD_NOT_ALLOWED'); }
        if (!changeCover || !coverStorage) throw new OperationError(503, 'COVERS_NOT_CONFIGURED');
        if (!UUID.test(cover[2]) || !/^"[a-f0-9]{64}"$/.test(req.headers['if-match'] || '')) throw new OperationError(400, 'INVALID_REQUEST');
        if (coverUploading) throw new OperationError(503, 'COVER_BUSY');
        coverUploading = true;
        try {
          const bytes = req.method === 'DELETE' ? null : await readCover(req);
          json(res, 200, await changeCover(cover[1], cover[2], req.headers['if-match'], bytes));
        } finally { coverUploading = false; }
        return;
      }
      const favorite = path.match(/^\/api\/collection\/([^/]+)\/favorite$/);
      if (favorite) {
        if (req.method !== 'PATCH') { res.setHeader('Allow', 'PATCH'); throw new OperationError(405, 'METHOD_NOT_ALLOWED'); }
        if (!changeFavorite) throw new OperationError(503, 'NOT_CONFIGURED');
        json(res, 200, await changeFavorite(favorite[1], req.headers['if-match'], await readBody(req))); return;
      }
      if (quoteSource && path === '/assets/data/music-quotes.json' && req.method === 'GET') { json(res, 200, quoteSource); return; }
      if (path === '/api/wishlist' || path.startsWith('/api/wishlist/')) {
        if (!getWishlist) { json(res, 503, { error: 'WISHLIST_NOT_CONFIGURED' }); return; }
        if (path === '/api/wishlist') {
          if (req.method === 'GET') { json(res, 200, visible(validateWishlist(await getWishlist()))); return; }
          if (req.method === 'POST') { json(res, 201, await createWishlistRecord(await readBody(req))); return; }
          res.setHeader('Allow', 'GET, POST'); json(res, 405, { error: 'METHOD_NOT_ALLOWED' }); return;
        }
        const transfer = path.match(/^\/api\/wishlist\/([^/]+)\/transfer$/);
        if (transfer) {
          if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); json(res, 405, { error: 'METHOD_NOT_ALLOWED' }); return; }
          json(res, 200, await transferRecord(transfer[1], req.headers['if-match'], await readBody(req))); return;
        }
        const target = path.match(/^\/api\/wishlist\/([^/]+)$/);
        if (target) {
          if (req.method === 'PUT') { json(res, 200, await updateWishlistRecord(target[1], req.headers['if-match'], await readBody(req))); return; }
          if (req.method !== 'DELETE') { res.setHeader('Allow', 'DELETE, PUT'); json(res, 405, { error: 'METHOD_NOT_ALLOWED' }); return; }
          json(res, 200, await deleteWishlistRecord(target[1], req.headers['if-match'])); return;
        }
        json(res, 404, { error: 'NOT_FOUND' }); return;
      }
      if (path === '/api/collection') {
        if (req.method === 'GET') { json(res, 200, visible(validateCollection(await getCollection()))); return; }
        if (req.method === 'POST' && createRecord) {
          json(res, 201, await createRecord(await readBody(req))); return;
        }
        res.setHeader('Allow', createRecord ? 'GET, POST' : 'GET');
        json(res, 405, { error: 'METHOD_NOT_ALLOWED' }); return;
      }
      if (/^\/api\/collection\/[^/]+$/.test(path) && deleteRecord) {
        if (req.method === 'PUT') { json(res, 200, await updateRecord(path.slice('/api/collection/'.length), req.headers['if-match'], await readBody(req))); return; }
        if (req.method !== 'DELETE') { res.setHeader('Allow', 'DELETE, PUT'); json(res, 405, { error: 'METHOD_NOT_ALLOWED' }); return; }
        json(res, 200, await deleteRecord(path.slice('/api/collection/'.length), req.headers['if-match'])); return;
      }
      const canonicalPage = pageAliases.get(path.replace(/\/+$/, ''));
      if (canonicalPage && canonicalPage !== path && (req.method === 'GET' || req.method === 'HEAD')) {
        res.writeHead(308, { Location: canonicalPage + req.url.slice(path.length) });
        res.end();
        return;
      }
      const file = clientFiles.get(path);
      if (!file) {
        json(res, 404, { error: 'NOT_FOUND' });
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
        return;
      }
      const content = await readFile(new URL(file[0], import.meta.url));
      res.writeHead(200, { 'Content-Type': file[1], 'Content-Length': content.length });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (error instanceof OperationError) { json(res, error.status, { error: error.message, ...error.details }); return; }
      const code = error instanceof WishlistDataError ? 'WISHLIST_DATA_INVALID'
        : error instanceof WishlistSourceError ? 'WISHLIST_SOURCE_UNAVAILABLE'
        : error instanceof CollectionDataError ? 'COLLECTION_DATA_INVALID'
        : error instanceof CollectionSourceError ? 'COLLECTION_SOURCE_UNAVAILABLE' : 'INTERNAL_ERROR';
      json(res, 500, { error: code });
    }
  });
}

async function readCover(req) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(req.headers['content-type']?.split(';')[0])) throw new OperationError(415, 'UNSUPPORTED_COVER_TYPE');
  if (Number(req.headers['content-length']) > COVER_MAX_BYTES) throw new OperationError(413, 'COVER_TOO_LARGE');
  const chunks = []; let length = 0;
  req.setTimeout(15000, () => req.destroy());
  try {
    for await (const chunk of req) {
      length += chunk.length;
      if (length > COVER_MAX_BYTES) throw new OperationError(413, 'COVER_TOO_LARGE');
      chunks.push(chunk);
    }
  } finally { req.setTimeout(0); }
  return Buffer.concat(chunks);
}

async function readBody(req, maximum = 65536) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new OperationError(400, 'INVALID_REQUEST');
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maximum) throw new OperationError(400, 'INVALID_REQUEST');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new OperationError(400, 'INVALID_REQUEST'); }
}
