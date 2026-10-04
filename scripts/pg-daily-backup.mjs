import {mkdir,readdir,readFile,writeFile,rename,rm,lstat} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {backendConfiguration,createPool} from '../server/postgres/config.mjs';
import {freeze} from '../server/postgres/boundary.mjs';
import {createBackup,fileHash} from '../server/postgres/backup.mjs';
import {retainedBackups} from '../server/postgres/retention.mjs';
const config=backendConfiguration(process.env),root=process.env.PG_BACKUP_ROOT;
if(config.backend!=='postgres'||!isAbsolute(root||''))throw Error('Explicit backup config required');
await mkdir(root,{recursive:true,mode:0o700});
const pool=createPool(config.url),operator=await pool.connect();let locked=false,thaw=false;
const status=async data=>{await writeFile(join(root,'status.tmp'),JSON.stringify(data,null,2),{mode:0o600});await rename(join(root,'status.tmp'),join(root,'status.json'));};
try{
 locked=(await operator.query('SELECT pg_try_advisory_lock(44160405) AS locked')).rows[0].locked;if(!locked)throw Error('Backup cycle already running');
 const control=(await pool.query('SELECT frozen FROM vinyl.runtime_control WHERE singleton')).rows[0];
 if(!control||control.frozen)throw Error('Manual freeze active; scheduled backup deferred');
 await freeze(pool,true);thaw=true;
 const name=new Date().toISOString().replaceAll('-','').replaceAll(':','').replace(/\.\d{3}Z$/,'Z');
 const directory=join(root,name);
 const manifest=await createBackup(pool,{url:config.url,bin:process.env.PG_BIN,directory,covers:process.env.COVERS_DIR,userId:config.ownerId});
 for(const f of manifest.files)if(await fileHash(join(directory,f.name))!==f.sha256)throw Error('Backup checksum mismatch');
 await freeze(pool,false);thaw=false;
 const verified=[];for(const candidate of await readdir(root))if(/^\d{8}T\d{6}Z$/.test(candidate)&&!(await lstat(join(root,candidate))).isSymbolicLink()){
  try{const m=JSON.parse(await readFile(join(root,candidate,'manifest.json'),'utf8'));if(m.format===1&&m.userId===config.ownerId&&m.files.some(f=>f.name==='database.dump'))verified.push(candidate);}catch{}
 }
 const keep=retainedBackups(verified);for(const old of verified)if(!keep.has(old))await rm(join(root,old),{recursive:true});
 await status({ok:true,completedAt:new Date().toISOString(),directory,retained:keep.size,infrastructureBackup:'Timeweb daily, owner-confirmed; provider timestamp unverified'});
 console.log(JSON.stringify({ok:true,directory,retained:keep.size}));
}catch{await status({ok:false,failedAt:new Date().toISOString(),error:'BACKUP_FAILED_OR_DEFERRED'});process.exitCode=1;}
finally{try{if(thaw)await freeze(pool,false);if(locked)await operator.query('SELECT pg_advisory_unlock(44160405)');}finally{operator.release();await pool.end();}}
