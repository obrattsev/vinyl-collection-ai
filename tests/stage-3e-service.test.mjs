import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamingService, streamingInput, matchAlbums } from '../server/streaming-service.mjs';
import { appleAlbumLinks } from '../src/streaming.mjs';
const input = { artist: 'Кино', album: 'Группа крови', albumYear: '1988', storefront: 'ru' };
const album = (extra = {}) => ({ wrapperType: 'collection', collectionType: 'Album', artistName: 'Кино', collectionName: 'Группа крови',
  collectionId: 1333010977, collectionViewUrl: 'https://music.apple.com/ru/album/gruppa-krovi/1333010977?uo=4', releaseDate: '1988-01-01T08:00:00Z', ...extra });
const payload = (...results) => ({ resultCount: results.length, results });
const reply = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'text/javascript; charset=utf-8' } });
const match = (...items) => matchAlbums(streamingInput(input), payload(...items));
test('3E exact matching normalizes only technical text, validates year and never chooses first blindly', () => {
  assert.equal(match(album()).status, 'matched');
  assert.equal(matchAlbums(streamingInput({ ...input, artist: ' КИНО ', album: ' Группа   крови ' }), payload(album())).status, 'matched');
  assert.equal(match(album({ artistName: 'Kino' })).status, 'not_found');
  assert.equal(match(album({ releaseDate: '2018-01-01T00:00:00Z' })).status, 'ambiguous');
  assert.equal(match(album({ collectionName: 'Группа крови (Remastered)' })).status, 'ambiguous');
  assert.equal(match(album({ collectionName: 'Другой альбом' }), album()).status, 'matched');
  assert.equal(match(album(), album()).status, 'matched');
});
test('3E edition ambiguity survives a single exact hit; candidates bounded to five, correct hit ranked first', () => {
  const variants = Array.from({ length: 9 }, (_, i) => album({ collectionName: 'Группа крови (Remastered)', collectionId: 100 + i, collectionViewUrl: `https://music.apple.com/ru/album/reissue/${100 + i}` }));
  const found = match(...variants, album()); assert.equal(found.status, 'ambiguous');
  assert.equal(found.candidates.length, 5); assert.equal(found.candidates[0].album, input.album);
});
test('3E input whitelist rejects private fields, missing year, oversized and control-character strings', () => {
  for (const value of [null, [], { ...input, id: 'private' }, { ...input, albumYear: null }, { ...input, storefront: 'de' }, { ...input, artist: 'a'.repeat(301) }, { ...input, album: '\u0000' }]) assert.throws(() => streamingInput(value), /INVALID_STREAMING_REQUEST/);
});
test('3E URL validation restricts provider, path and region; query parameters never reach iframe', () => {
  const links = appleAlbumLinks(album().collectionViewUrl, 'ru');
  assert.equal(links.embedUrl, 'https://embed.music.apple.com/ru/album/gruppa-krovi/1333010977');
  for (const url of ['javascript:alert(1)', 'http://music.apple.com/ru/album/123', 'https://evil.test/ru/album/123', 'https://music.apple.com.evil.test/ru/album/123', 'https://user@music.apple.com/ru/album/123', 'https://music.apple.com:444/ru/album/123', 'https://music.apple.com/us/album/123', 'https://music.apple.com/ru/artist/123', 'https://music.apple.com/ru/album/123#x']) {
    assert.equal(appleAlbumLinks(url, 'ru'), null); assert.throws(() => match(album({ collectionViewUrl: url })), /STREAMING_INVALID_RESPONSE/);
  }
});
test('3E lookup uses fixed API, metadata-only query, coalesces concurrent work and clones RAM cache', async () => {
  let release, calls = 0, options;
  const wait = new Promise(resolve => { release = resolve; });
  const lookup = createStreamingService({ fetch: async (url, opts) => { calls++; options = opts;
    assert.equal(new URL(url).origin, 'https://itunes.apple.com'); assert.equal(new URL(url).searchParams.get('country'), 'ru'); await wait; return reply(payload(album())); } });
  const first = lookup(input), second = lookup({ ...input, artist: ' КИНО ' }); release();
  const a = await first, b = await second; a.candidates[0].album = 'changed';
  assert.equal(b.candidates[0].album, input.album); assert.equal((await lookup(input)).candidates[0].album, input.album);
  assert.equal(calls, 1); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.deepEqual(options.headers, { Accept: 'application/json' });
});
test('3E empty result has bounded second search and short TTL; US is a fresh region-specific lookup', async () => {
  let time = 0; const calls = [];
  const lookup = createStreamingService({ now: () => time, fetch: async url => { calls.push(new URL(url)); return reply(payload()); } });
  assert.equal((await lookup(input)).status, 'not_found'); assert.equal(calls.length, 2);
  assert.equal(calls[1].searchParams.get('attribute'), 'albumTerm');
  await lookup(input); assert.equal(calls.length, 2); time = 300001; await lookup(input); assert.equal(calls.length, 4);
  await lookup({ ...input, storefront: 'us' }); assert.equal(calls.length, 6); assert.equal(calls.at(-1).searchParams.get('country'), 'us');
});
test('3E cache has bounded LRU size and successful-result TTL', async () => {
  let calls = 0, time = 0; const lookup = createStreamingService({ maxCache: 1, now: () => time, fetch: async () => { calls++; return reply(payload(album())); } });
  await lookup(input); await lookup({ ...input, albumYear: '1989' }); await lookup(input); assert.equal(calls, 3);
  time += 3600001; await lookup(input); assert.equal(calls, 4);
});
test('3E bounded concurrency rejects different lookup and releases capacity after completion', async () => {
  let release; const wait = new Promise(resolve => { release = resolve; });
  const lookup = createStreamingService({ maxConcurrent: 1, fetch: async () => { await wait; return reply(payload(album())); } });
  const first = lookup(input); await assert.rejects(lookup({ ...input, albumYear: '1989' }), /STREAMING_BUSY/);
  release(); await first; assert.equal((await lookup({ ...input, albumYear: '1989' })).status, 'ambiguous');
});
test('3E hard timeout covers fetch and response body; failures are not cached as no-result', async () => {
  let calls = 0;
  const lookup = createStreamingService({ timeoutMs: 15, fetch: async () => { calls++; return new Promise(() => {}); } });
  await assert.rejects(lookup(input), /STREAMING_TIMEOUT/); await assert.rejects(lookup(input), /STREAMING_TIMEOUT/); assert.equal(calls, 2);
  let aborted = false;
  const stalled = createStreamingService({ timeoutMs: 15, fetch: async (_, { signal }) => { signal.addEventListener('abort', () => { aborted = true; }); return new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'application/json' } }); } });
  await assert.rejects(stalled(input), /STREAMING_TIMEOUT/); assert.equal(aborted, true);
});
test('3E rate limits: provider Retry-After cooldown and independent outgoing request budget', async () => {
  let calls = 0; const limited = createStreamingService({ fetch: async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '23' } }); } });
  await assert.rejects(limited(input), error => error.status === 429 && error.details.retryAfter === 23);
  await assert.rejects(limited(input), /STREAMING_RATE_LIMITED/); assert.equal(calls, 1);
  const budget = createStreamingService({ maxRequests: 1, fetch: async () => reply(payload(album())) });
  await budget(input); await assert.rejects(budget({ ...input, albumYear: '1990' }), /STREAMING_RATE_LIMITED/);
});
for (const [name, fetch, code] of [
  ['network', async () => { throw Error('network'); }, 'STREAMING_UNAVAILABLE'],
  ['upstream', async () => new Response('', { status: 503 }), 'STREAMING_UNAVAILABLE'],
  ['html', async () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } }), 'STREAMING_INVALID_RESPONSE'],
  ['json', async () => new Response('{', { headers: { 'Content-Type': 'application/json' } }), 'STREAMING_INVALID_RESPONSE'],
  ['schema', async () => reply({ resultCount: 1, results: [] }), 'STREAMING_INVALID_RESPONSE'],
  ['size', async () => reply({ x: 'x'.repeat(2000) }), 'STREAMING_INVALID_RESPONSE'],
  ['id mismatch', async () => reply(payload(album({ collectionId: 42 }))), 'STREAMING_INVALID_RESPONSE']
]) test(`3E ${name} stays a distinct failure`, async () => { await assert.rejects(createStreamingService({ fetch, maxBytes: 1024 })(input), new RegExp(code)); });
