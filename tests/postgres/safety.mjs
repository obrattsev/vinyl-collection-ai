import { localDatabaseUrl } from '../../server/postgres/config.mjs';
export async function requireTestDatabase(pool, env = process.env) {
  if (env.NODE_ENV !== 'test' || !/^[a-f0-9]{48}$/.test(env.PG_TEST_TOKEN || '')) throw Error('Explicit test environment and ownership token required');
  const url = new URL(localDatabaseUrl(env.DATABASE_URL));
  if (!/^\/vinyl_4a_test_[a-z0-9_]+$/.test(url.pathname)) throw Error('Not a test database');
  const { rows:[db] } = await pool.query(`SELECT current_database() AS name, pg_get_userbyid(datdba) AS owner,
    shobj_description(oid,'pg_database') AS marker, current_user AS actor FROM pg_database WHERE datname=current_database()`);
  if (db.name !== url.pathname.slice(1) || db.owner !== db.actor || db.marker !== `vinyl-4a-test:${env.PG_TEST_TOKEN}`) throw Error('Test database ownership marker mismatch');
}
