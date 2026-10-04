// Future timer entrypoint. No offsite transfer is silently assumed.
import {backendConfiguration,createPool} from '../server/postgres/config.mjs';
import {freeze} from '../server/postgres/boundary.mjs';
import {createBackup} from '../server/postgres/backup.mjs';
const config=backendConfiguration(process.env);if(config.backend!=='postgres')throw Error('PG required');
const pool=createPool(config.url);let thaw=false;
try {
 const control=(await pool.query('SELECT frozen FROM vinyl.runtime_control WHERE singleton')).rows[0];
 if(!control)throw Error('Missing control');
 if(!control.frozen){await freeze(pool,true);thaw=true;}
 const report=await createBackup(pool,{url:config.url,bin:process.env.PG_BIN,directory:process.argv[2],covers:process.env.COVERS_DIR,userId:config.ownerId});
 console.log(JSON.stringify({localBackupVerified:true,createdAt:report.createdAt,offsiteVerified:false,restoreRehearsalRequired:true}));
}finally{try{if(thaw)await freeze(pool,false);}finally{await pool.end();}}
