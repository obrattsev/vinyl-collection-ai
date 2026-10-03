import pg from 'pg';
import { UUID } from '../../src/base-record.mjs';

// 4A deliberately cannot select PG in production. No implicit PG* environment fallback.
export function backendConfiguration(env) {
  const backend = env.DATA_BACKEND || 'sheets';
  if (!['sheets', 'postgres'].includes(backend)) throw Error('Invalid DATA_BACKEND');
  if (backend === 'sheets') return { backend };
  if (!['development', 'test'].includes(env.NODE_ENV)) throw Error('PostgreSQL is local-only in Stage 4A');
  const url = localDatabaseUrl(env.DATABASE_URL);
  if (!UUID.test(env.PG_LOCAL_OWNER_ID || '')) throw Error('PG_LOCAL_OWNER_ID must be a fixture UUID');
  return { backend, url, ownerId: env.PG_LOCAL_OWNER_ID.toLowerCase() };
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
export function createPool(url) {
  const pool = new pg.Pool({ connectionString: localDatabaseUrl(url), max: 5,
    connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000,
    statement_timeout: 10000, lock_timeout: 5000, idle_in_transaction_session_timeout: 15000 });
  pool.on('error', () => { /* Idle connection errors must not expose credentials or crash HTTP. */ });
  return pool;
}
