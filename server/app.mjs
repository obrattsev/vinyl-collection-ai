import { publicRecords } from '../src/public-record.mjs';
import { OperationError } from './collection-service.mjs';
import { WishlistDataError, validateWishlist } from '../src/wishlist-record.mjs';
import { WishlistSourceError } from './google-sheets-wishlist.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { CollectionDataError, validateCollection } from '../src/collection-record.mjs';
import { CollectionSourceError } from './google-sheets-collection.mjs';

// No user-controlled filesystem paths, directory listing, or repository-wide serving.
const clientFiles = new Map([
  ['/src/public-record.mjs', ['../src/public-record.mjs', 'text/javascript; charset=utf-8']],
  ['/prototype/wishlist.html', ['../prototype/wishlist.html', 'text/html; charset=utf-8']],
  ['/src/base-record.mjs', ['../src/base-record.mjs', 'text/javascript; charset=utf-8']],
  ['/src/wishlist-record.mjs', ['../src/wishlist-record.mjs', 'text/javascript; charset=utf-8']],
  ['/src/wishlist-rules.mjs', ['../src/wishlist-rules.mjs', 'text/javascript; charset=utf-8']],
  ['/prototype/', ['../prototype/index.html', 'text/html; charset=utf-8']],
  ['/prototype/index.html', ['../prototype/index.html', 'text/html; charset=utf-8']],
  ['/prototype/styles.css', ['../prototype/styles.css', 'text/css; charset=utf-8']],
  ['/prototype/app.js', ['../prototype/app.js', 'text/javascript; charset=utf-8']],
  ['/prototype/input-controls.mjs', ['../prototype/input-controls.mjs', 'text/javascript; charset=utf-8']],
  ['/src/genres.mjs', ['../src/genres.mjs', 'text/javascript; charset=utf-8']],
  ['/src/collection-record.mjs', ['../src/collection-record.mjs', 'text/javascript; charset=utf-8']],
  ['/src/collection-rules.mjs', ['../src/collection-rules.mjs', 'text/javascript; charset=utf-8']]
]);

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function createApp({ getCollection, createRecord, deleteRecord, getWishlist, createWishlistRecord, deleteWishlistRecord, transferRecord }, { auth } = {}) {
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
      if (unsafe) auth.requireOwner(req, session);
      if (req.method === 'GET' && path.startsWith('/api/') && !session) auth?.limit(req, 'read', res);
      const visible = records => session ? records : publicRecords(records);
      res.setHeader('X-Access-Role', session ? 'owner' : 'guest');
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
          if (req.method !== 'DELETE') { res.setHeader('Allow', 'DELETE'); json(res, 405, { error: 'METHOD_NOT_ALLOWED' }); return; }
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
        if (req.method !== 'DELETE') { res.setHeader('Allow', 'DELETE'); json(res, 405, { error: 'METHOD_NOT_ALLOWED' }); return; }
        json(res, 200, await deleteRecord(path.slice('/api/collection/'.length), req.headers['if-match'])); return;
      }
      if ((path === '/' || path === '/prototype') && (req.method === 'GET' || req.method === 'HEAD')) {
        res.writeHead(302, { Location: '/prototype/' });
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

async function readBody(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new OperationError(400, 'INVALID_REQUEST');
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw new OperationError(400, 'INVALID_REQUEST');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new OperationError(400, 'INVALID_REQUEST'); }
}
