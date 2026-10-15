import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validatePublicRecords } from '../src/public-record.mjs';

const sha = /^[a-f0-9]{40}$/;
const hash = /^[a-f0-9]{64}$/;
const fail = code => { throw Error(code); };

// Inspect packaged files, never import or execute a candidate's code.
export async function inspectRelease(directory, externalPolicy) {
  const release = (await readFile(join(directory, 'RELEASE'), 'utf8')).trim();
  if (!sha.test(release)) fail('INVALID_RELEASE');
  const policy = JSON.parse(await readFile(externalPolicy || join(directory, 'release-policy.json'), 'utf8'));
  if (policy.format !== 1 || policy.authMode !== 'multiuser' ||
      !Number.isSafeInteger(policy.minimumSchema) || !Number.isSafeInteger(policy.maximumSchema) ||
      policy.minimumSchema < 5 || policy.maximumSchema < policy.minimumSchema ||
      (externalPolicy && policy.release !== release)) fail('INVALID_RELEASE_POLICY');
  const names = (await readdir(join(directory, 'migrations'))).filter(n => n.endsWith('.sql')).sort();
  if (!names.length || names.some((n, i) => !/^\d{3}_[a-z0-9_]+\.sql$/.test(n) || !n.startsWith(`${String(i + 1).padStart(3, '0')}_`))) fail('INVALID_MIGRATION_SEQUENCE');
  const migrations = await Promise.all(names.map(async name => ({ name,
    checksum: createHash('sha256').update(await readFile(join(directory, 'migrations', name))).digest('hex') })));
  // A legacy binary may have been reviewed against a later additive migration.
  // Only an external, exact-SHA-bound operator declaration can attest that;
  // every additional migration must have an explicit name AND checksum.
  if (policy.compatibleMigrations !== undefined) {
    if (!externalPolicy || !Array.isArray(policy.compatibleMigrations)) fail('INVALID_COMPATIBILITY_ATTESTATION');
    for (const migration of policy.compatibleMigrations) {
      if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(migration.name||'') || !migration.name.startsWith(`${String(migrations.length+1).padStart(3,'0')}_`) ||
          !hash.test(migration.checksum||'')) fail('INVALID_COMPATIBILITY_ATTESTATION');
      migrations.push({name:migration.name,checksum:migration.checksum});
    }
  }
  // Conservative: unknown future schema is never declared rollback-compatible.
  if (policy.maximumSchema > migrations.length) fail('UNVERIFIABLE_SCHEMA_RANGE');
  return { release, policy, migrations };
}

function prefix(applied, known) {
  return applied.length <= known.length && applied.every((m, i) =>
    m.name === known[i].name && hash.test(m.checksum) && m.checksum === known[i].checksum);
}
export function supportsSchema(artifact, applied) {
  return applied.length >= artifact.policy.minimumSchema && applied.length <= artifact.policy.maximumSchema && prefix(applied, artifact.migrations);
}

export function releasePlan({ candidate, rollback, applied, frozen, mirrors }, phase = 'before') {
  if (!['before', 'after'].includes(phase)) fail('INVALID_PHASE');
  if (!Array.isArray(applied) || !applied.length || !prefix(applied, candidate.migrations)) fail('SCHEMA_HISTORY_MISMATCH');
  if (frozen !== false) fail('EXISTING_FREEZE');
  if (!Array.isArray(mirrors) || mirrors.some(m => m.last_error || String(m.generation) !== String(m.synced_generation))) fail('MIRROR_NOT_SYNCED');
  const pending = candidate.migrations.slice(applied.length);
  const projected = [...applied, ...pending];
  if (!supportsSchema(candidate, projected)) fail('CANDIDATE_SCHEMA_INCOMPATIBLE');
  if (!supportsSchema(rollback, applied) || !supportsSchema(rollback, projected)) fail('ROLLBACK_SCHEMA_INCOMPATIBLE');
  if (phase === 'after' && pending.length) fail('MIGRATIONS_NOT_APPLIED');
  return { candidate: candidate.release, rollback: rollback.release, phase,
    pending: pending.map(m => m.name), schema: applied.length,
    projectedSchema: projected.length, compatible: true,
    migrationReviewRequired: pending.length > 0 };
}

export async function checkRelease(pool, candidate, rollback, phase, expectedMirrorOwner) {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const applied = (await client.query('SELECT name, checksum FROM vinyl.schema_migrations ORDER BY name')).rows;
    const control = (await client.query('SELECT frozen FROM vinyl.runtime_control WHERE singleton')).rows[0];
    const mirrors = (await client.query('SELECT user_id, generation, synced_generation, last_error FROM vinyl.mirror_state')).rows;
    if (expectedMirrorOwner !== undefined && (expectedMirrorOwner === null ? mirrors.length !== 0 :
      mirrors.length !== 1 || mirrors[0].user_id !== expectedMirrorOwner)) fail('MIRROR_CONFIGURATION_MISMATCH');
    const plan = releasePlan({ candidate, rollback, applied, frozen: control?.frozen, mirrors }, phase);
    await client.query('COMMIT');
    return plan;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { broken = true; }
    throw error;
  } finally { client.release(broken); }
}

export async function smokeRelease(origin, { fetch: request = globalThis.fetch, timeout = 5000, publicLogin } = {}) {
  const base = new URL(origin);
  if (base.username || base.password || base.pathname !== '/' || base.search || base.hash ||
      !(base.protocol === 'https:' || (base.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(base.hostname)))) fail('INVALID_SMOKE_ORIGIN');
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30000) fail('INVALID_SMOKE_TIMEOUT');
  if (publicLogin && !/^[a-z][a-z0-9_-]{2,29}$/.test(publicLogin)) fail('INVALID_PUBLIC_LOGIN');
  const checks = [
    ['/', 200, 'html'], ['/auth', 200, 'html'],
    ['/assets/auth-ui.mjs', 200, 'javascript'], ['/assets/quote-background.webp', 200, 'image'],
    ['/collection', 302, 'redirect'], ['/wishlist', 302, 'redirect'],
    ['/api/collection', 401, 'denied'], ['/api/wishlist', 401, 'denied'],
    ['/api/auth/session', 200, 'session']
  ];
  if (publicLogin) checks.push([`/${publicLogin}/collection`, 200, 'html'], [`/api/u/${publicLogin}/collection`, 200, 'public']);
  const results = [];
  for (const [path, status, kind] of checks) {
    // No cookies, credentials, POST, redirects or external subresources.
    const response = await request(new URL(path, base), { method: 'GET', redirect: 'manual', credentials: 'omit',
      signal: AbortSignal.timeout(timeout), headers: { Accept: kind === 'html' ? 'text/html' : '*/*' } });
    try {
      if (response.status !== status) fail('SMOKE_STATUS');
      const type = response.headers.get('content-type') || '';
      if (kind === 'html' && !type.includes('text/html')) fail('SMOKE_CONTENT_TYPE');
      if (kind === 'javascript' && !type.includes('javascript')) fail('SMOKE_CONTENT_TYPE');
      if (kind === 'image' && !type.startsWith('image/')) fail('SMOKE_CONTENT_TYPE');
      if (kind === 'redirect' && response.headers.get('location') !== '/') fail('SMOKE_GUEST_REDIRECT');
      if (['denied', 'session', 'public'].includes(kind)) {
        if (!type.includes('application/json')) fail('SMOKE_CONTENT_TYPE');
        const body = await response.json();
        if (kind === 'denied' && body.error !== 'AUTH_REQUIRED') fail('SMOKE_GUEST_ACCESS');
        if (kind === 'session' && (body.role !== 'guest' || body.authMode !== 'multiuser' || body.userId || body.csrfToken)) fail('SMOKE_SESSION');
        if (kind === 'public') validatePublicRecords(body, false);
      }
      results.push({ path, status, passed: true });
    } finally { if (!response.bodyUsed) await response.body?.cancel(); }
  }
  return results;
}
