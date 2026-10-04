import pg from 'pg';
import { UUID } from '../../src/base-record.mjs';

// Production requires an explicit opt-in; no fallback and no implicit PG* environment.
export function backendConfiguration(env) {
  const backend = env.DATA_BACKEND || 'sheets';
  if (!['sheets', 'postgres'].includes(backend)) throw Error('Invalid DATA_BACKEND');
  if (backend === 'sheets') {
    if (env.MIRROR_ENABLED === 'true') throw Error('Mirror requires PostgreSQL');
    return { backend };
  }
  const url = configuredDatabaseUrl(env);
  const owner = env.PG_OWNER_ID || (env.NODE_ENV !== 'production' ? env.PG_LOCAL_OWNER_ID : null);
  if (!UUID.test(owner || '')) throw Error('Explicit PG_OWNER_ID required');
  if (env.PG_OWNER_ID && env.PG_LOCAL_OWNER_ID && env.PG_OWNER_ID.toLowerCase() !== env.PG_LOCAL_OWNER_ID.toLowerCase()) throw Error('Ambiguous owner');
  return { backend, url, ownerId: owner.toLowerCase() };
}
export function configuredDatabaseUrl(env) {
  if (env.NODE_ENV === 'production') {
    if (env.DATA_BACKEND !== 'postgres' || env.PG_PRODUCTION_ACK !== 'stage4b') throw Error('Production PG requires explicit cutover configuration');
    const url = new URL(connectionUrl(env.DATABASE_URL));
    if (url.pathname !== '/vinyl_production' || !url.password || ['postgres','vinyl_4a_admin'].includes(decodeURIComponent(url.username))) throw Error('Invalid production database/role');
    return url.href;
  }
  if (!['development','test'].includes(env.NODE_ENV)) throw Error('Explicit NODE_ENV required');
  return localDatabaseUrl(env.DATABASE_URL);
}
function connectionUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw Error('Explicit DATABASE_URL required'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || !url.port || url.search || url.hash || !url.username) throw Error('Only explicit loopback connections are allowed');
  return url.href;
}
export function localDatabaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw Error('Explicit local DATABASE_URL required'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' ||
      !url.port || url.search || url.hash || !/^\/vinyl_4a_(test|acceptance)_[a-z0-9_]+$/.test(url.pathname) || !url.username) {
    throw Error('Only explicit loopback Stage 4A databases are allowed');
  }
  return url.href;
}
export function createPool(url, { max = 3 } = {}) {
  // Callers select environment via configuredDatabaseUrl; retain an allowlist here too.
  const parsed = new URL(connectionUrl(url));
  if (parsed.pathname !== '/vinyl_production') localDatabaseUrl(url);
  const pool = new pg.Pool({ connectionString: parsed.href, max,
    connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000,
    statement_timeout: 10000, lock_timeout: 5000, idle_in_transaction_session_timeout: 15000 });
  pool.on('error', () => { /* Idle connection errors must not expose credentials or crash HTTP. */ });
  return pool;
}
