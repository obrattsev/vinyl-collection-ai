import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validReport, reportLength } from '../src/bug-report.mjs';
import { createReportService, createReportRepository, REPORT_COLUMNS, reportConfiguration, readRelease } from '../server/bug-reports.mjs';
import { createReportLimiter } from '../server/auth.mjs';
import { createApp } from '../server/app.mjs';
import { testAuth, loginOwner } from './fixtures/auth.mjs';
import { deferred } from './fixtures/prototype-dom.mjs';
const input = { text: '=HYPERLINK("test")\nСообщение', section: 'collection' };
function memory() {
  const records = [];
  return { records, getRecords: async () => structuredClone(records), appendRecord: async value => records.push(structuredClone(value)) };
}
async function start(t, services = {}) {
  const server = createApp({ getCollection: async () => [], getWishlist: async () => [], ...services }, { auth: testAuth() });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, post: (body = input, headers = {}) => fetch(url + '/api/bug-reports', { method: 'POST',
    headers: { Origin: url, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }) };
}
test('reports validate exact client fields and 2000 Unicode code points, preserving text', () => {
  assert.equal(reportLength('😀'), 1);
  assert.ok(validReport({ ...input, text: '😀'.repeat(2000) }));
  for (const value of [null, [], {}, { ...input, text: '😀'.repeat(2001) }, { ...input, text: '  \n' },
    { ...input, section: 'other' }, { ...input, text: 1 }, { ...input, text: '\ud800' }]) assert.equal(validReport(value), false);
  for (const key of ['id', 'createdAt', 'version', 'cookie', 'csrfToken', 'ip', 'url', 'referrer', 'record', 'userAgent', 'password']) assert.equal(validReport({ ...input, [key]: 'x' }), false);
});
test('report config is optional, paired, fixed and isolated from either collection document', () => {
  assert.equal(reportConfiguration({}), null);
  assert.deepEqual(reportConfiguration({ BUG_REPORT_SPREADSHEET_ID: 'reports', BUG_REPORT_SHEET_NAME: 'Reports' }), { spreadsheetId: 'reports', sheetName: 'Reports' });
  for (const env of [{ BUG_REPORT_SPREADSHEET_ID: 'x' }, { BUG_REPORT_SHEET_NAME: 'x' },
    { BUG_REPORT_SPREADSHEET_ID: 'bad/id', BUG_REPORT_SHEET_NAME: 'x' },
    { BUG_REPORT_SPREADSHEET_ID: 'x', BUG_REPORT_SHEET_NAME: ' ' },
    ...['COLLECTION_SPREADSHEET_ID', 'WISHLIST_SPREADSHEET_ID'].map(key => ({ [key]: 'x', BUG_REPORT_SPREADSHEET_ID: 'x', BUG_REPORT_SHEET_NAME: 'Reports' }))]) assert.throws(() => reportConfiguration(env));
});
test('release reads existing identifier, missing or invalid local version is null', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'vinyl-release-')); t.after(() => rm(dir, { recursive: true }));
  const path = join(dir, 'RELEASE'); assert.equal(await readRelease(path), null);
  await writeFile(path, 'a'.repeat(40) + '\n'); assert.equal(await readRelease(path), 'a'.repeat(40));
  await writeFile(path, 'unknown\nsecret'); assert.equal(await readRelease(path), null);
});
test('report success verifies all fields and generates only server ID/time/version; no text echo', async () => {
  const repo = memory(); const now = () => new Date('2026-09-24T12:00:00.000Z');
  const result = await createReportService(repo, { now, version: 'a'.repeat(40) })(input);
  assert.deepEqual(Object.keys(result), ['id']);
  assert.deepEqual(repo.records, [{ ...input, id: result.id, createdAt: now().toISOString(), version: 'a'.repeat(40) }]);
});
test('report invalid input or unavailable read never attempts a write and sanitizes errors', async () => {
  let writes = 0;
  const service = createReportService({ getRecords: async () => { throw Error('secret'); }, appendRecord: async () => writes++ });
  await assert.rejects(service({ ...input, password: 'secret' }), { status: 400, message: 'INVALID_REPORT' });
  await assert.rejects(service(input), { status: 503, message: 'REPORT_SOURCE_UNAVAILABLE' }); assert.equal(writes, 0);
});
test('lost write response is verified without retry; unconfirmed write and altered record fail', async () => {
  for (const mode of ['saved', 'missing', 'altered', 'read-error']) {
    const repo = memory(); let writes = 0;
    repo.appendRecord = async candidate => { writes++; if (mode !== 'missing') repo.records.push({ ...candidate, ...(mode === 'altered' ? { text: 'changed' } : {}) }); throw Error('lost secret'); };
    const read = repo.getRecords; repo.getRecords = async () => { if (writes && mode === 'read-error') throw Error('secret'); return read(); };
    const task = createReportService(repo)(input);
    if (mode === 'saved') assert.ok((await task).id); else await assert.rejects(task, { status: 500, message: 'RESULT_UNCONFIRMED' });
    assert.equal(writes, 1);
  }
});
test('report queue is bounded and failures release capacity', async () => {
  const wait = deferred(); const repo = memory(); let reads = 0;
  const original = repo.getRecords; repo.getRecords = async () => { if (++reads === 1) await wait.promise; return original(); };
  const service = createReportService(repo); const jobs = Array.from({ length: 4 }, () => service(input));
  await assert.rejects(service(input), { status: 503, message: 'REPORT_BUSY' });
  wait.resolve(); await Promise.all(jobs); await service(input); assert.equal(repo.records.length, 5);
});
test('reports use typed stringValue for formula-looking text and expose append/read only', async () => {
  let values = [Object.keys(REPORT_COLUMNS)]; const writes = [];
  const auth = { getClient: async () => ({ request: async options => {
    assert.equal(options.retry, false);
    if (options.method === 'POST') {
      writes.push(options); const cells = options.data.requests[0].appendCells.rows[0].values;
      values.push(cells.map(cell => cell.userEnteredValue?.stringValue ?? null)); return { data: {} };
    }
    return options.params.fields ? { data: { sheets: [{ properties: { sheetId: 7, title: 'Reports' } }] } } : { data: { values } };
  } }) };
  const repo = createReportRepository({ spreadsheetId: 'reports-only', sheetName: 'Reports', auth });
  assert.deepEqual(Object.keys(repo).sort(), ['appendRecord', 'getRecords']);
  await createReportService(repo)(input);
  const cells = writes[0].data.requests[0].appendCells.rows[0].values;
  assert.deepEqual(cells[2], { userEnteredValue: { stringValue: input.text } });
  assert.equal(writes.length, 1); assert.equal((await repo.getRecords())[0].text, input.text);
});
test('report limiter enforces independent rolling client and hourly ceilings, expires correctly', () => {
  let time = 1000000; const limit = createReportLimiter({ now: () => time });
  for (let i = 0; i < 3; i++) assert.equal(limit('a'), 0);
  assert.equal(limit('a'), 900); time += 899000; assert.equal(limit('a'), 1);
  time += 1000; assert.equal(limit('a'), 0);
  for (let i = 0; i < 46; i++) assert.equal(limit(`peer${i}`), 0);
  assert.equal(limit('other'), 2700); time += 2700000; assert.equal(limit('other'), 0);
});
for (const owner of [false, true]) test(`report HTTP owner=${owner}: guest exception is exact and has no public inbox`, async t => {
  const repo = memory(); const { url, post } = await start(t, { createReport: createReportService(repo) });
  const headers = owner ? await loginOwner(url) : {};
  const result = await post(input, headers); assert.equal(result.status, 201); assert.ok((await result.json()).id);
  for (const method of ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']) {
    const res = await fetch(url + '/api/bug-reports', { method, headers: { Origin: url, ...headers } }); assert.equal(res.status, 405);
  }
  for (const [method, path] of [['POST', '/api/collection'], ['PUT', '/api/collection/id'], ['DELETE', '/api/collection/id'],
    ['POST', '/api/wishlist'], ['PUT', '/api/wishlist/id'], ['DELETE', '/api/wishlist/id'], ['POST', '/api/wishlist/id/transfer']]) {
    assert.equal((await fetch(url + path, { method, headers: { Origin: url } })).status, 401);
  }
  assert.equal(repo.records.length, 1);
});
test('report HTTP rejects cross-origin, absent origin and spoofed section metadata', async t => {
  const repo = memory(); const { post } = await start(t, { createReport: createReportService(repo) });
  for (const headers of [{ Origin: 'https://evil.example' }, { Origin: '' }, { 'Sec-Fetch-Site': 'cross-site' }]) assert.equal((await post(input, headers)).status, 403);
  assert.equal((await post({ ...input, id: 'client-id' })).status, 400); assert.equal(repo.records.length, 0);
});
test('report HTTP rate counts invalid attempts, emits Retry-After and leaves public GET available', async t => {
  const { url, post } = await start(t, { createReport: createReportService(memory()) });
  for (let i = 0; i < 3; i++) assert.equal((await post({})).status, 400);
  const res = await post(); assert.equal(res.status, 429); assert.ok(Number(res.headers.get('Retry-After')) > 0);
  assert.equal((await fetch(url + '/api/collection')).status, 200);
  await loginOwner(url);
});
test('report HTTP body limit counts bytes, accepts 2000 emoji, rejects oversized JSON and wrong content type', async t => {
  const repo = memory(); const { url, post } = await start(t, { createReport: createReportService(repo) });
  assert.equal((await post({ ...input, text: '😀'.repeat(2000) })).status, 201);
  const res = await fetch(url + '/api/bug-reports', { method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json' }, body: JSON.stringify(input) + ' '.repeat(16384) });
  assert.equal(res.status, 400);
  assert.equal((await post(input, { 'Content-Type': 'text/plain' })).status, 400); assert.equal(repo.records.length, 1);
});
test('unconfigured report API fails closed without touching collection sources', async t => {
  const { post } = await start(t); const result = await post(); assert.equal(result.status, 503);
  assert.deepEqual(await result.json(), { error: 'REPORT_NOT_CONFIGURED' });
});
