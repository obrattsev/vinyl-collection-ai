import {readFile,writeFile,rename} from 'node:fs/promises';
import {backendConfiguration} from '../server/postgres/config.mjs';
import {mirrorConfiguration} from '../server/mirror-sheets.mjs';
const config=mirrorConfiguration(process.env,backendConfiguration(process.env));
if(process.env.NODE_ENV!=='development'||!config?.fakeFile)throw Error('Local fake mirror only');
const mode=process.argv[2];if(!['outage','recover','drift','show'].includes(mode))throw Error('Usage: pg-mirror-fixture.mjs outage|recover|drift|show');
const data=JSON.parse(await readFile(config.fakeFile,'utf8'));
if(mode==='show')console.log(JSON.stringify(data,null,2));
else {
 if(mode==='drift')data.collection=[];else data.outage=mode==='outage';
 await writeFile(config.fakeFile+'.operator',JSON.stringify(data,null,2),{mode:0o600});await rename(config.fakeFile+'.operator',config.fakeFile);
 console.log('Local fixture changed; run reconciliation. Stop worker before editing fixture.');
}
