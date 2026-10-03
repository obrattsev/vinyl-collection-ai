import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export const migrationDirectory = new URL('../../migrations/', import.meta.url);
export async function migrate(pool, directory = migrationDirectory) {
  const names = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
  if (!names.length || names.some((name, index) => !name.startsWith(`${String(index + 1).padStart(3, '0')}_`) || !/^\d{3}_[a-z0-9_]+\.sql$/.test(name))) throw Error('Invalid migration sequence');
  const files = await Promise.all(names.map(async name => {
    const sql = await readFile(new URL(name, directory), 'utf8');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock(44160401)'); locked = true;
    await client.query('BEGIN');
    await client.query('CREATE SCHEMA IF NOT EXISTS vinyl');
    await client.query('CREATE TABLE IF NOT EXISTS vinyl.schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    await client.query('COMMIT');
    const applied = (await client.query('SELECT name, checksum FROM vinyl.schema_migrations ORDER BY name')).rows;
    if (applied.some((item, index) => files[index]?.name !== item.name || files[index]?.checksum !== item.checksum)) throw Error('Migration history/checksum mismatch');
    for (const file of files.slice(applied.length)) {
      await client.query('BEGIN');
      await client.query(file.sql);
      await client.query('INSERT INTO vinyl.schema_migrations(name, checksum) VALUES ($1,$2)', [file.name, file.checksum]);
      await client.query('COMMIT');
    }
    return files.map(({ name }) => name);
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally {
    let broken = false;
    if (locked) { try { await client.query('SELECT pg_advisory_unlock(44160401)'); } catch { broken = true; } }
    client.release(broken);
  }
}
