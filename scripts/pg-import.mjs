import { readFile } from 'node:fs/promises';
import { createPool } from '../server/postgres/config.mjs';
import { importSnapshot, validateSnapshot } from '../server/postgres/importer.mjs';
if (!['development','test'].includes(process.env.NODE_ENV)) throw Error('Local NODE_ENV required');
const [file,mode] = process.argv.slice(2);
if (!file || !['--dry-run','--apply'].includes(mode)) throw Error('Usage: pg-import.mjs snapshot.json --dry-run|--apply');
const snapshot = JSON.parse(await readFile(file,'utf8'));
if (mode === '--dry-run') console.log(validateSnapshot(snapshot).report);
else {
  const pool = createPool(process.env.DATABASE_URL);
  try { console.log(await importSnapshot(pool,snapshot,{dryRun:false})); } finally { await pool.end(); }
}
