import {backendConfiguration,createPool} from '../server/postgres/config.mjs';
import {mirrorConfiguration,sheetsMirror} from '../server/mirror-sheets.mjs';
import {fakeMirror} from '../server/mirror-fake.mjs';
import {createBackup} from '../server/postgres/backup.mjs';
const config=backendConfiguration(process.env);if(config.backend!=='postgres')throw Error('PG required');
const mirror=mirrorConfiguration(process.env,config),pool=createPool(config.url);
try{const report=await createBackup(pool,{url:config.url,bin:process.env.PG_BIN,directory:process.argv[2],covers:process.env.COVERS_DIR,userId:config.ownerId,adapter:mirror?(mirror.fakeFile?fakeMirror(mirror.fakeFile):sheetsMirror(mirror)):null});console.log(JSON.stringify({verifiedArchive:true,files:report.files,verification:report.verification,restoreRehearsalRequired:true}));}finally{await pool.end();}
