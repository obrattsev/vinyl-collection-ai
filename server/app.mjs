import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { CollectionDataError, validateCollection } from '../src/collection-record.mjs';
import { CollectionSourceError } from './google-sheets-collection.mjs';

// No user-controlled filesystem paths, directory listing, or repository-wide serving.
const clientFiles = new Map([
  ['/prototype/', ['../prototype/index.html', 'text/html; charset=utf-8']],
  ['/prototype/index.html', ['../prototype/index.html', 'text/html; charset=utf-8']],
  ['/prototype/styles.css', ['../prototype/styles.css', 'text/css; charset=utf-8']],
  ['/prototype/app.js', ['../prototype/app.js', 'text/javascript; charset=utf-8']],
  ['/src/collection-rules.mjs', ['../src/collection-rules.mjs', 'text/javascript; charset=utf-8']]
]);

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function createApp({ getCollection }) {
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const path = req.url.split('?')[0];
    try {
      if (path === '/api/collection') {
        if (req.method !== 'GET') {
          res.setHeader('Allow', 'GET');
          json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
          return;
        }
        json(res, 200, validateCollection(await getCollection()));
        return;
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
      const code = error instanceof CollectionDataError ? 'COLLECTION_DATA_INVALID'
        : error instanceof CollectionSourceError ? 'COLLECTION_SOURCE_UNAVAILABLE' : 'INTERNAL_ERROR';
      json(res, 500, { error: code });
    }
  });
}
