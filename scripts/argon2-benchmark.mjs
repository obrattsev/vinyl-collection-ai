// Local/non-production only. A measured RSS budget is NOT a Linux cgroup limit.
// Run each profile in a fresh process; native allocations must not cross samples.
import { argon2, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import sharp from 'sharp';
import { createApp } from '../server/app.mjs';
import { createCoverStorage } from '../server/cover-storage.mjs';
import { createResourceGate } from '../server/security/resource-gate.mjs';
import { record } from '../tests/fixtures/collection.mjs';
import { createPool } from '../server/postgres/config.mjs';
import { requireTestDatabase } from '../tests/postgres/safety.mjs';
import { createPostgresServices } from '../server/postgres/services.mjs';
import { wish } from '../tests/fixtures/wishlist.mjs';

if (process.env.NODE_ENV !== 'development' || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('Explicit development mode without data credentials required');
const profiles = { '64m-t3': { memory: 65536, passes: 3 }, '48m-t3': { memory: 49152, passes: 3 }, '32m-t4': { memory: 32768, passes: 4 } };
const name = process.argv[2];
if (!Object.hasOwn(profiles, name)) throw Error('Select a benchmark candidate: 64m-t3, 48m-t3, 32m-t4');
const derive = promisify(argon2), profile = profiles[name];
const root = await mkdtemp(join(tmpdir(), 'vinyl-argon2-benchmark-'));
const covers = createCoverStorage(join(root, 'covers'));
const gate = createResourceGate({ concurrency: 1, capacity: 4, timeoutMs: 15000 });
const collection = Array.from({ length: 100 }, (_, i) => ({ ...record, id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }));
const wishlist = [{ ...wish }];
let pool, services={getCollection:async()=>structuredClone(collection),getWishlist:async()=>structuredClone(wishlist)}, expectedCount=100;
if(process.env.DATABASE_URL){
  pool=createPool(process.env.DATABASE_URL);await requireTestDatabase(pool,{...process.env,NODE_ENV:'test'});
  const owner=(await pool.query('SELECT user_id FROM vinyl.collection_records GROUP BY user_id ORDER BY count(*) DESC LIMIT 1')).rows[0];
  if(!owner)throw Error('Fixture data required for PG benchmark');
  services=createPostgresServices(pool,owner.user_id);expectedCount=(await services.getCollection()).length;
}
const server = createApp(services, { auth: { session: () => ({ fixture: true }), limit() {} } });
const samples = [], reads = [], coverTimes = [];
let reading = true, failure, maximumRss = 0;
const monitor = setInterval(() => {
  maximumRss = Math.max(maximumRss, process.memoryUsage().rss);
  if (maximumRss > 512 * 1024 * 1024) { console.error('RSS budget exceeded; candidate rejected'); process.exit(2); }
}, 10);
try {
  // Fixture at the real Cover pixel ceiling; never reads user images.
  const png = await sharp({ create: { width: 4000, height: 4000, channels: 3, background: '#8d6048' } }).png().toBuffer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const traffic = Array.from({ length: 2 }, async () => {
    try {
      while (reading) {
        const start = performance.now();
        const response = await fetch(`${base}/api/collection`);
        if (!response.ok || (await response.json()).length !== expectedCount) throw Error('HTTP regression');
        reads.push(performance.now() - start);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    } catch (error) { failure = error; reading = false; }
  });
  const images = (async () => {
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      await covers.prepare(png);
      coverTimes.push(performance.now() - start);
    }
  })();
  try {
    for (let batch = 0; batch < 4; batch++) await Promise.all(Array.from({ length: 5 }, () => gate.run(async () => {
      const start = performance.now();
      const output = await derive('argon2id', { ...profile, parallelism: 1, tagLength: 32, nonce: randomBytes(16), message: Buffer.from('Synthetic local benchmark password') });
      if (output.length !== 32) throw Error('Unexpected KDF output');
      samples.push(performance.now() - start);
    })));
    await images;
  } finally { reading = false; await Promise.all(traffic); }
  if (failure) throw failure;
  let cgroupMemoryLimit = null;
  if (process.platform === 'linux') cgroupMemoryLimit = await readFile('/sys/fs/cgroup/memory.max', 'utf8').then(s => s.trim()).catch(() => null);
  const stats = values => { const sorted = [...values].sort((a,b) => a-b); return { count: sorted.length, p50Ms: Math.round(sorted[Math.floor(sorted.length * .5)]), p95Ms: Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))]) }; };
  console.log(JSON.stringify({ candidate: name, parameters: { ...profile, parallelism: 1, tagLength: 32 }, node: process.version, platform: process.platform, architecture: process.arch, cgroupMemoryLimit, hard512MiBLimitConfirmed: cgroupMemoryLimit === '536870912', dataSource: pool?'marked local PG fixture database; real HTTP handlers and Covers pipeline':'synthetic repositories; real HTTP handlers and Covers pipeline', concurrency: 1, queueCapacity: 4, kdf: stats(samples), http: stats(reads), covers: stats(coverTimes), peakRssMiB: Math.ceil(Math.max(maximumRss, process.resourceUsage().maxRSS * 1024) / 1048576), qualification: 'Mac-only local screening authorized by owner; production Linux cgroup/CPU behavior not measured' }, null, 2));
} finally {
  reading = false; clearInterval(monitor);
  server.close(); server.closeAllConnections();
  await pool?.end();
  await rm(root, { recursive: true, force: true });
}
