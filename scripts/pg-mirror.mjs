import { setTimeout as delay } from 'node:timers/promises';
import { backendConfiguration,createPool } from '../server/postgres/config.mjs';
import { mirrorConfiguration,sheetsMirror } from '../server/mirror-sheets.mjs';
import { fakeMirror } from '../server/mirror-fake.mjs';
import { enableMirror,mirrorStatus,reconcile } from '../server/postgres/mirror.mjs';
const mode=process.argv[2];
if(!['enable','status','reconcile','worker'].includes(mode))throw Error('Usage: pg-mirror.mjs enable|status|reconcile|worker');
const backend=backendConfiguration(process.env),config=mirrorConfiguration(process.env,backend);
if(!config)throw Error('Mirror configuration required');
const pool=createPool(backend.url,{max:1});
const adapter=config.fakeFile?fakeMirror(config.fakeFile):sheetsMirror(config);
let stopped=false;const abort=new AbortController();
for(const s of ['SIGINT','SIGTERM'])process.once(s,()=>{stopped=true;abort.abort();});
try {
  if(mode==='enable')await enableMirror(pool,config.ownerId);
  else if(mode==='status')console.log(JSON.stringify(await mirrorStatus(pool,config.ownerId)));
  else if(mode==='reconcile'){const r=await reconcile(pool,config.ownerId,adapter,{force:true});console.log(JSON.stringify(r));if(r.status!=='verified')process.exitCode=1;}
  else do {
    try{const r=await reconcile(pool,config.ownerId,adapter);if(!['waiting','busy'].includes(r.status))console.log(JSON.stringify(r));}
    catch{console.error('MIRROR_DATABASE_UNAVAILABLE');}
    if(!stopped)await delay(5000,undefined,{signal:abort.signal}).catch(()=>{});
  }while(!stopped);
}finally{await pool.end();}
