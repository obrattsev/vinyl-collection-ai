import { inspectRelease, checkRelease } from '../server/release-safety.mjs';
import { backendConfiguration, createPool } from '../server/postgres/config.mjs';
import { mirrorConfiguration } from '../server/mirror-sheets.mjs';

let pool;
try {
  const [candidateDir, rollbackDir, phase = 'before', rollbackPolicy] = process.argv.slice(2);
  if (!candidateDir || !rollbackDir || process.argv.length > 6) throw Error('ARGUMENTS');
  const candidate = await inspectRelease(candidateDir);
  const rollback = await inspectRelease(rollbackDir, rollbackPolicy);
  const backend = backendConfiguration(process.env);
  if (backend.backend !== 'postgres' || process.env.AUTH_MODE !== 'multiuser') throw Error('RUNTIME_CONFIGURATION');
  const mirror = mirrorConfiguration(process.env, backend);
  pool = createPool(backend.url, { max: 1 });
  console.log(JSON.stringify(await checkRelease(pool, candidate, rollback, phase, mirror?.ownerId || null)));
} catch {
  // DB/file/network errors can embed credentials/paths; do not print raw exceptions.
  console.error('Release check failed. Inspect policies, migration checksums, freeze and mirror state using the release checklist.');
  process.exitCode = 1;
} finally { await pool?.end(); }
