import {readFile,lstat,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createPool,localDatabaseUrl} from '../server/postgres/config.mjs';
import {requireTestDatabase} from '../tests/postgres/safety.mjs';
import {fileHash,pgCommand,safeFiles} from '../server/postgres/backup.mjs';
import {recordRepository} from '../server/postgres/repositories.mjs';
import {snapshotReport,stateHash} from '../server/postgres/mirror.mjs';
const directory=resolve(process.argv[2]||'');if(!process.argv[2]||!process.argv[3])throw Error('Usage: pg-restore-rehearsal.mjs backup-directory new-cover-directory');
const url=localDatabaseUrl(process.env.DATABASE_URL),pool=createPool(url);
try {
  await requireTestDatabase(pool);
  if((await pool.query("SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('public','information_schema')")).rowCount || (await pool.query("SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','v','S','m')")).rowCount)throw Error('Rehearsal requires empty test DB');
  const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
  if(manifest.format!==1)throw Error('Unknown backup format');
  for(const f of manifest.files){if(!/^[a-z-]+\.(json|dump|tar)$/.test(f.name)||(await lstat(join(directory,f.name))).isSymbolicLink()||await fileHash(join(directory,f.name))!==f.sha256)throw Error('Backup checksum mismatch');}
  const target=resolve(process.argv[3]);await mkdir(target,{mode:0o700});
  // Only trusted, checksum-verified artifacts created by pg-backup; no arbitrary archives.
  const exec=promisify(execFile);const listing=(await exec('/usr/bin/tar',['-tf',join(directory,'covers.tar')])).stdout.split('\n').filter(Boolean);
  if(listing.some(p=>p.startsWith('/')||p.split('/').includes('..')))throw Error('Unsafe archive paths');
  const verbose=(await exec('/usr/bin/tar',['-tvf',join(directory,'covers.tar')])).stdout.split('\n').filter(Boolean);
  if(verbose.some(line=>!['-','d'].includes(line[0])))throw Error('Archive contains links or special files');
  await exec('/usr/bin/tar',['-xf',join(directory,'covers.tar'),'-C',target]);
  if(stateHash(await safeFiles(target))!==stateHash(manifest.coverFiles))throw Error('Restored cover checksums differ');
  await pgCommand(process.env.PG_BIN,'pg_restore',url,['--exit-on-error','--single-transaction','--no-owner','--no-privileges','--dbname',new URL(url).pathname.slice(1),join(directory,'database.dump')]);
  const snapshot={};for(const section of ['collection','wishlist'])snapshot[section]=await recordRepository(pool,manifest.userId,section).list();
  if(stateHash(snapshotReport(snapshot))!==stateHash(manifest.verification))throw Error('Restored data differs');
  console.log(JSON.stringify({restored:true,verification:snapshotReport(snapshot),coverFiles:manifest.coverFiles.length}));
}finally{await pool.end();}
