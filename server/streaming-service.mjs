import { OperationError } from './record-operations.mjs';
import { normalizeStreaming, appleAlbumLinks } from '../src/streaming.mjs';

const fail = (status, code, retryAfter) => new OperationError(status, code, retryAfter ? { retryAfter } : undefined);
export function streamingInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).sort().join(',') !== 'album,albumYear,artist,storefront' ||
      !['artist', 'album'].every(key => typeof input[key] === 'string' && input[key].trim() && input[key].length <= 300 && !/[\u0000-\u001f\u007f]/u.test(input[key])) ||
      !/^\d{4}$/.test(String(input.albumYear)) || !['string', 'number'].includes(typeof input.albumYear) ||
      !['ru', 'us'].includes(input.storefront)) throw fail(400, 'INVALID_STREAMING_REQUEST');
  return { artist: normalizeStreaming(input.artist), album: normalizeStreaming(input.album), albumYear: String(input.albumYear), storefront: input.storefront };
}
// Recognized edition suffixes can be offered, never silently accepted as an exact title.
const baseTitle = value => value.replace(/\s*[([](?:[^\])]*(?:remaster|deluxe|anniversary|expanded|live|remix)[^\])]*)[\])]$/iu, '').trim();
export function matchAlbums(input, payload) {
  if (!payload || !Number.isInteger(payload.resultCount) || !Array.isArray(payload.results) ||
      payload.resultCount !== payload.results.length || payload.results.length > 200) throw fail(502, 'STREAMING_INVALID_RESPONSE');
  const seen = new Set(), candidates = [];
  for (const item of payload.results) {
    const links = appleAlbumLinks(item?.collectionViewUrl, input.storefront);
    if (!item || item.wrapperType !== 'collection' || item.collectionType !== 'Album' ||
        !['artistName', 'collectionName'].every(key => typeof item[key] === 'string' && item[key].trim() && item[key].length <= 1000) ||
        !Number.isSafeInteger(item.collectionId) || !links || links.id !== String(item.collectionId) ||
        typeof item.releaseDate !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(item.releaseDate) || !Number.isFinite(Date.parse(item.releaseDate))) throw fail(502, 'STREAMING_INVALID_RESPONSE');
    const artist = normalizeStreaming(item.artistName), album = normalizeStreaming(item.collectionName);
    if (artist !== input.artist || (album !== input.album && baseTitle(album) !== baseTitle(input.album)) || seen.has(links.id)) continue;
    seen.add(links.id);
    const year = item.releaseDate.slice(0, 4);
    candidates.push({ artist: item.artistName, album: item.collectionName, year, url: links.url,
      exact: album === input.album && year === input.albumYear });
  }
  candidates.sort((a, b) => Number(b.exact) - Number(a.exact) || Math.abs(Number(a.year) - Number(input.albumYear)) - Math.abs(Number(b.year) - Number(input.albumYear)) || a.album.localeCompare(b.album) || a.url.localeCompare(b.url));
  const status = !candidates.length ? 'not_found' : candidates.length === 1 && candidates[0].exact ? 'matched' : 'ambiguous';
  return { status, storefront: input.storefront, candidates: candidates.slice(0, 5).map(({ exact, ...candidate }) => candidate) };
}

export function createStreamingService({ fetch: request = globalThis.fetch, now = Date.now, timeoutMs = 5000,
  maxBytes = 512 * 1024, maxCache = 500, maxConcurrent = 2, maxRequests = 15 } = {}) {
  const cache = new Map(), pending = new Map(); let active = 0, attempts = [], cooldown = 0;
  async function search(input, albumOnly = false) {
    const time = now(); attempts = attempts.filter(value => value > time - 60000);
    if (time < cooldown) throw fail(429, 'STREAMING_RATE_LIMITED', Math.ceil((cooldown - time) / 1000));
    if (attempts.length >= maxRequests) throw fail(429, 'STREAMING_RATE_LIMITED', Math.max(1, Math.ceil((attempts[0] + 60000 - time) / 1000)));
    attempts.push(time);
    const url = new URL('https://itunes.apple.com/search');
    url.search = new URLSearchParams({ term: albumOnly ? input.album : `${input.artist} ${input.album}`, media: 'music', entity: 'album',
      country: input.storefront, limit: '50', ...(albumOnly ? { attribute: 'albumTerm' } : {}) }).toString();
    const controller = new AbortController(); let timer;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(fail(504, 'STREAMING_TIMEOUT')); }, timeoutMs); });
    const read = async () => {
      let response;
      try { response = await request(url.href, { signal: controller.signal, redirect: 'error', credentials: 'omit', headers: { Accept: 'application/json' } }); }
      catch { throw fail(503, 'STREAMING_UNAVAILABLE'); }
      if (response.status === 429) {
        const raw = response.headers.get('retry-after');
        const seconds = /^\d+$/.test(raw || '') ? Number(raw) : Math.ceil((Date.parse(raw) - now()) / 1000);
        const retry = Math.min(3600, Math.max(1, Number.isFinite(seconds) ? seconds : 60));
        cooldown = now() + retry * 1000;
        await response.body?.cancel(); throw fail(429, 'STREAMING_RATE_LIMITED', retry);
      }
      if (!response.ok) { await response.body?.cancel(); throw fail(503, 'STREAMING_UNAVAILABLE'); }
      // iTunes also serves JSON as text/javascript. No JSONP callback is requested.
      if (!/^(application\/json|text\/javascript)\b/i.test(response.headers.get('content-type') || '') ||
          Number(response.headers.get('content-length')) > maxBytes || !response.body) {
        await response.body?.cancel(); throw fail(502, 'STREAMING_INVALID_RESPONSE');
      }
      const reader = response.body.getReader(); let length = 0; const chunks = [];
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          length += value.byteLength;
          if (length > maxBytes) throw fail(502, 'STREAMING_INVALID_RESPONSE');
          chunks.push(Buffer.from(value));
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      let payload;
      try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw fail(502, 'STREAMING_INVALID_RESPONSE'); }
      return matchAlbums(input, payload);
    };
    try { return await Promise.race([read(), deadline]); }
    catch (error) { if (error instanceof OperationError) throw error; throw fail(503, 'STREAMING_UNAVAILABLE'); }
    finally { clearTimeout(timer); controller.abort(); }
  }
  return async function lookup(value) {
    const input = streamingInput(value), key = JSON.stringify(['v1', input.artist, input.album, input.albumYear, input.storefront]);
    const entry = cache.get(key);
    if (entry && entry.until > now()) { cache.delete(key); cache.set(key, entry); return structuredClone(entry.value); }
    cache.delete(key);
    if (pending.has(key)) return structuredClone(await pending.get(key));
    if (active >= maxConcurrent) throw fail(503, 'STREAMING_BUSY', 2);
    active++;
    const work = (async () => {
      let result = await search(input);
      if (result.status === 'not_found') result = await search(input, true);
      cache.set(key, { value: result, until: now() + (result.status === 'not_found' ? 300000 : 3600000) });
      while (cache.size > maxCache) cache.delete(cache.keys().next().value);
      return result;
    })();
    pending.set(key, work);
    try { return structuredClone(await work); }
    finally { pending.delete(key); active--; }
  };
}
