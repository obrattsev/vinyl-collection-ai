import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import sharp from 'sharp';
import { createPool, backendConfiguration } from '../server/postgres/config.mjs';
import { migrate } from '../server/postgres/migrations.mjs';
import { importSnapshot } from '../server/postgres/importer.mjs';
import { createPostgresServices } from '../server/postgres/services.mjs';
import { createCoverStorage } from '../server/cover-storage.mjs';
import { createAuth, hashPassword } from '../server/auth.mjs';
import { createApp } from '../server/app.mjs';
import { createStreamingService } from '../server/streaming-service.mjs';
import { createReportService } from '../server/bug-reports.mjs';
import { record } from '../tests/fixtures/collection.mjs';
import { wish } from '../tests/fixtures/wishlist.mjs';
import { enableMirror } from '../server/postgres/mirror.mjs';
const userId='11111111-1111-4111-8111-111111111111';
const config=backendConfiguration({...process.env,DATA_BACKEND:'postgres',PG_LOCAL_OWNER_ID:userId});
if (process.env.NODE_ENV !== 'development' || !new URL(config.url).pathname.startsWith('/vinyl_4a_acceptance_')) throw Error('Dedicated local acceptance database required');
const port=Number(process.env.PG_ACCEPTANCE_PORT || '8045');
if (!Number.isInteger(port) || port<1024 || port>65535) throw Error('Invalid local port');
const origin=`http://127.0.0.1:${port}`;
const pool=createPool(config.url);
const db=(await pool.query("SELECT shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0];
if (!/^vinyl-4a-acceptance:[a-f0-9]{48}$/.test(db.marker || '')) { await pool.end(); throw Error('Unmarked acceptance database'); }
await migrate(pool);
if ((await pool.query('SELECT id FROM vinyl.users LIMIT 1')).rowCount) { await pool.end();throw Error('Acceptance requires a new empty database; existing data never reset'); }
const root=process.env.PG_ACCEPTANCE_ROOT || tmpdir();
if (!isAbsolute(root)) throw Error('PG_ACCEPTANCE_ROOT must be absolute');
const directory=await mkdtemp(join(root,'vinyl-4b-acceptance-'));
const covers=createCoverStorage(join(directory,'covers'));
const png=await sharp({create:{width:480,height:480,channels:3,background:'#8d6048'}}).png().toBuffer();
await writeFile(join(directory,'sample.png'),png,{mode:0o600});
const cover=await covers.prepare(png);
const manifest={importKey:'local_acceptance_4b',user:{id:userId,login:'Obrattsev',email:'fixture-owner@example.test',collectionPublic:true,wishlistPublic:true},
 collection:[{...record,id:randomUUID(),artist:'Pink Floyd',album:'The Wall',albumYear:'1979',coverId:cover,favorite:true},
 {...record,id:randomUUID(),artist:'Alpha',album:'First',albumYear:'1980',note:'Текст; "кавычки"\nНовая строка'},
 {...record,id:randomUUID(),artist:'Alpha',album:'Second',albumYear:'1990',purchasePrice:0}],
 wishlist:[{...wish,id:randomUUID(),artist:'Кино',album:'Группа крови',albumYear:'1988',coverId:cover},
 {...wish,id:randomUUID(),artist:'Wish Alpha',album:'Transfer me',albumYear:'2000'}],covers:[cover]};
await importSnapshot(pool,manifest,{dryRun:false});
await writeFile(join(directory,'source-manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});
await writeFile(join(directory,'mirror.json'),JSON.stringify({collection:[],wishlist:[],outage:false},null,2),{mode:0o600});
await enableMirror(pool,userId);
const password='local-pg-only-password-4B';
const passwordHash=await hashPassword(password);
await writeFile(join(directory,'restart.env'),`NODE_ENV=development\nDATA_BACKEND=postgres\nDATABASE_URL=${config.url}\nPG_OWNER_ID=${userId}\nMIRROR_ENABLED=true\nMIRROR_OWNER_ID=${userId}\nMIRROR_FAKE_FILE=${join(directory,'mirror.json')}\nCOVERS_DIR=${join(directory,'covers')}\nPORT=${port}\nAPP_ORIGIN=${origin}\nOWNER_PASSWORD_HASH=${passwordHash}\n`,{mode:0o600});
const reports=[];
const services=createPostgresServices(pool,userId,covers);
services.lookupStreaming=createStreamingService();
services.createReport=createReportService({getRecords:async()=>structuredClone(reports),appendRecord:async r=>{reports.push(r);}});
const server=createApp(services,{auth:createAuth({passwordHash,origin})});
server.on('error',async()=>{console.error('Local acceptance could not listen; fixture data retained.');await pool.end();process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`PostgreSQL 4B acceptance: ${origin}/collection\nPassword: ${password}\nFixtures only. Bug reports: local memory; Streaming: real read-only Apple lookup.\nSample image / covers / fake mirror: ${directory}\nDB edits persist; restarting this script does NOT reset or re-import the DB.`));
for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{server.close(async()=>{await pool.end();process.exit(0);});server.closeIdleConnections();});
