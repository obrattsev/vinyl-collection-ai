import {readFile} from 'node:fs/promises';
import {backendConfiguration,createPool} from '../server/postgres/config.mjs';
import {verifyImport,rollbackGate} from '../server/postgres/verification.mjs';
import {mirrorConfiguration,sheetsMirror} from '../server/mirror-sheets.mjs';
import {fakeMirror} from '../server/mirror-fake.mjs';
const config=backendConfiguration(process.env);if(config.backend!=='postgres')throw Error('PG required');
const pool=createPool(config.url);
try {
  let report;
  if(process.argv[2]==='rollback') {
    const mirror=mirrorConfiguration(process.env,config);if(!mirror)throw Error('Mirror required');
    report=await rollbackGate(pool,config.ownerId,mirror.fakeFile?fakeMirror(mirror.fakeFile):sheetsMirror(mirror));
  } else report=await verifyImport(pool,JSON.parse(await readFile(process.argv[2],'utf8')));
  console.log(JSON.stringify(report,null,2));if(!report.verified)process.exitCode=1;
}finally{await pool.end();}
