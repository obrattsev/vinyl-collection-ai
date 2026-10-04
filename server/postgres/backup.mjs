import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,readFile,readdir,lstat,chmod} from 'node:fs/promises';
import {join,isAbsolute,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {recordRepository,validId} from './repositories.mjs';
import {MIRROR_LOCK,snapshotReport} from './mirror.mjs';
const exec=promisify(execFile);
export const fileHash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
export async function safeFiles(root,prefix='') {
  if(!prefix&&(await lstat(root)).isSymbolicLink())throw Error('Symlink cover root refused');
  const found=[];
  for(const name of (await readdir(join(root,prefix))).sort()) {
    const relative=join(prefix,name),s=await lstat(join(root,relative));
    if(s.isSymbolicLink()||(!s.isFile()&&!s.isDirectory()))throw Error('Unsafe cover filesystem entry');
    if(s.isDirectory())found.push(...await safeFiles(root,relative));else found.push({path:relative,size:s.size,sha256:await fileHash(join(root,relative))});
  }
  return found;
}
export async function pgCommand(bin,command,url,args) {
  if(!isAbsolute(bin)||!['pg_dump','pg_restore'].includes(command))throw Error('Explicit PG binary directory required');
  const u=new URL(url);
  // Credentials only in subprocess environment; never argv/output.
  const env={PATH:process.env.PATH,HOME:process.env.HOME,PGHOST:u.hostname,PGPORT:u.port,PGDATABASE:u.pathname.slice(1),PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGCONNECT_TIMEOUT:'5'};
  try{return await exec(join(bin,command),args,{env,maxBuffer:8*1024*1024});}catch{throw Error(`${command} failed; backup/rehearsal incomplete`);}
}
export async function createBackup(pool,{url,bin,directory,covers,userId,adapter}) {
  if(!isAbsolute(directory)||!isAbsolute(covers)||resolve(directory)===resolve(covers)||resolve(directory).startsWith(resolve(covers)+'/'))throw Error('Separate absolute backup destination required');
  userId=validId(userId);const client=await pool.connect();let locked=false,broken=false;
  try {
    locked=(await client.query('SELECT pg_try_advisory_lock($1) AS locked',[MIRROR_LOCK])).rows[0].locked;
    if(!locked)throw Error('Stop mirror worker before backup');
    // Exclusive freeze barrier for the entire artifact, preventing concurrent unfreeze.
    await client.query('SELECT pg_advisory_lock(44160403)');
    const control=(await client.query('SELECT * FROM vinyl.runtime_control WHERE singleton')).rows[0];
    if(!control?.frozen)throw Error('Freeze and drain required before backup');
    await mkdir(directory,{mode:0o700}); // Must be a new directory; no overwrite.
    const canonical={};for(const section of ['collection','wishlist'])canonical[section]=await recordRepository(client,userId,section).list();
    await writeFile(join(directory,'canonical.json'),JSON.stringify(canonical),{mode:0o600});
    if(adapter)for(const section of ['collection','wishlist']) {
      const snapshot=adapter.raw?await adapter.raw(section):await adapter.read(section);
      await writeFile(join(directory,`${section}-sheet.json`),JSON.stringify(snapshot),{mode:0o600});
    }
    const coverFiles=await safeFiles(covers);
    await exec('/usr/bin/tar',['-cf',join(directory,'covers.tar'),'-C',covers,'.']);
    await exec('/usr/bin/tar',['-tf',join(directory,'covers.tar')]);
    await pgCommand(bin,'pg_dump',url,['--format=custom','--no-owner','--no-privileges','--file',join(directory,'database.dump')]);
    const listing=await pgCommand(bin,'pg_restore',url,['--list',join(directory,'database.dump')]);
    if(!listing.stdout.includes('collection_records'))throw Error('Dump table inventory missing');
    const files=[];for(const name of await readdir(directory)){await chmod(join(directory,name),0o600);files.push({name,sha256:await fileHash(join(directory,name)),bytes:(await lstat(join(directory,name))).size});}
    const manifest={format:1,createdAt:new Date().toISOString(),userId,control,verification:snapshotReport(canonical),coverFiles,files};
    await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});
    return manifest;
  }finally {
    if(locked)try{await client.query('SELECT pg_advisory_unlock_all()');}catch{broken=true;}
    client.release(broken);
  }
}
