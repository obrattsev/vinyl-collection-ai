import { smokeRelease } from '../server/release-safety.mjs';
try {
  const [origin, publicLogin] = process.argv.slice(2);
  if (!origin || process.argv.length > 4) throw Error('ARGUMENTS');
  console.log(JSON.stringify({ passed: true, checks: await smokeRelease(origin, { publicLogin }) }));
} catch {
  console.error('Read-only release smoke failed. Keep maintenance closed and follow the rollback checklist.');
  process.exitCode = 1;
}
