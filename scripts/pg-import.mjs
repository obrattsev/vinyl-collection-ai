import { readFile } from 'node:fs/promises';
import { createPool,configuredDatabaseUrl } from '../server/postgres/config.mjs';
import { importSnapshot, validateSnapshot } from '../server/postgres/importer.mjs';
const url=configuredDatabaseUrl(process.env);
const [file,mode] = process.argv.slice(2);
if (!file || !['--dry-run','--apply'].includes(mode)) throw Error('Usage: pg-import.mjs snapshot.json --dry-run|--apply');
const snapshot = JSON.parse(await readFile(file,'utf8'));
if(process.env.NODE_ENV==='production'&&validateSnapshot(snapshot).report.canonicalizedIds)throw Error('Review UUID case/revision continuity before production import');
if (mode === '--dry-run') console.log(validateSnapshot(snapshot).report);
else {
  const pool = createPool(url);
  try { console.log(await importSnapshot(pool,snapshot,{dryRun:false})); } finally { await pool.end(); }
}
