import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import sharp from 'sharp';
import { createPool, backendConfiguration, localDatabaseUrl } from '../../server/postgres/config.mjs';
import { migrate, migrationDirectory } from '../../server/postgres/migrations.mjs';
import { insertUser, userInput } from '../../server/postgres/users.mjs';
import { recordRepository, coverRepository, ownerTransaction } from '../../server/postgres/repositories.mjs';
import { createPostgresServices } from '../../server/postgres/services.mjs';
import { importSnapshot } from '../../server/postgres/importer.mjs';
import { requireTestDatabase } from './safety.mjs';
import { record } from '../fixtures/collection.mjs';
import { wish, wishDraft, purchase } from '../fixtures/wishlist.mjs';
import { recordRevision } from '../../src/collection-record.mjs';
import { wishlistRevision } from '../../src/wishlist-record.mjs';
import { searchCollection } from '../../src/collection-rules.mjs';
import { sortRecords, recordsCsv } from '../../prototype/record-presentation.mjs';
import { publicRecords } from '../../src/public-record.mjs';
import { createApp } from '../../server/app.mjs';
import { testAuth, loginOwner } from '../fixtures/auth.mjs';
import { createCoverStorage } from '../../server/cover-storage.mjs';
import { ownerBoundary,freeze } from '../../server/postgres/boundary.mjs';
import { enableMirror,reconcile,mirrorStatus } from '../../server/postgres/mirror.mjs';
import { mirrorConfiguration,sheetsMirror } from '../../server/mirror-sheets.mjs';
import { verifyImport,rollbackGate } from '../../server/postgres/verification.mjs';
import { createBackup } from '../../server/postgres/backup.mjs';
const pool = createPool(process.env.DATABASE_URL);
const draft = ({id,coverId,favorite,...rest}) => rest;
const fail = (code,status) => error => error.message === code && (!status || error.status === status);
async function user(overrides={}) {
  const tag = randomUUID().replaceAll('-','').slice(0,16);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const u = await insertUser(client,{id:randomUUID(),login:`user_${tag}`,email:`${tag}@example.test`,...overrides});
    await client.query('COMMIT'); return u;
  } catch(e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}
async function context() { const u=await user(); return {u,s:createPostgresServices(pool,u.id)}; }
function snapshot(overrides={}) {
 const tag=randomUUID().replaceAll('-','').slice(0,16);
 return {importKey:`fixture_${tag}`,user:{id:randomUUID(),login:`imp_${tag}`,email:`${tag}@example.test`},
   collection:[{...record,id:randomUUID()}],wishlist:[{...wish,id:randomUUID()}],covers:[],...overrides};
}
before(async () => { await requireTestDatabase(pool); await migrate(pool); });
after(async () => { await pool.end(); });

test('configuration defaults to Sheets; production and remote PG refused', () => {
 assert.deepEqual(backendConfiguration({NODE_ENV:'production',DATABASE_URL:'ignored'}),{backend:'sheets'});
 assert.throws(()=>backendConfiguration({NODE_ENV:'production',DATA_BACKEND:'postgres'}));
 for(const value of ['postgres://u:p@host:5432/vinyl_4a_test_x','postgres://u:p@127.0.0.1:5432/postgres',process.env.DATABASE_URL+'?host=evil']) assert.throws(()=>localDatabaseUrl(value));
 assert.throws(()=>backendConfiguration({NODE_ENV:'test',DATA_BACKEND:'postgres',DATABASE_URL:process.env.DATABASE_URL,PG_LOCAL_OWNER_ID:'bad'}));
});
test('safety refuses missing/wrong token and acceptance DB before mutation', async()=>{
 await assert.rejects(requireTestDatabase(pool,{...process.env,PG_TEST_TOKEN:'0'.repeat(48)}));
 await assert.rejects(requireTestDatabase(pool,{...process.env,NODE_ENV:'production'}));
 await assert.rejects(requireTestDatabase(pool,{...process.env,DATABASE_URL:process.env.DATABASE_URL.replace('vinyl_4a_test_','vinyl_4a_acceptance_')}));
});
test('migrations repeat concurrently without duplicate application',async()=>{
 await Promise.all([migrate(pool),migrate(pool)]);
 assert.equal((await pool.query('SELECT count(*) FROM vinyl.schema_migrations')).rows[0].count,'2');
});
test('migration checksum mismatch and failed DDL never become successful',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vinyl-migration-test-'));const url=pathToFileURL(dir+'/');
 try {
  const first=await readFile(new URL('001_data_foundation.sql',migrationDirectory),'utf8');
  await writeFile(join(dir,'001_data_foundation.sql'),first+'\n-- changed');
  await assert.rejects(migrate(pool,url),/checksum/);
  await writeFile(join(dir,'001_data_foundation.sql'),first);
  await writeFile(join(dir,'002_cutover_mirror.sql'),await readFile(new URL('002_cutover_mirror.sql',migrationDirectory),'utf8'));
  await writeFile(join(dir,'003_failure.sql'),'CREATE TABLE vinyl.must_rollback(id int); SELECT 1/0;');
  await assert.rejects(migrate(pool,url));
  assert.equal((await pool.query("SELECT to_regclass('vinyl.must_rollback') AS name")).rows[0].name,null);
  assert.equal((await pool.query('SELECT count(*) FROM vinyl.schema_migrations')).rows[0].count,'2');
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('normalized identity uniqueness is enforced under races; defaults private',async()=>{
 const tag='race_'+randomUUID().slice(0,8);
 const results=await Promise.allSettled([user({login:tag,email:`${tag}@example.test`}),user({login:tag.toUpperCase(),email:`other_${tag}@example.test`})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const one=results.find(r=>r.status==='fulfilled').value;
 assert.equal(one.collectionPublic,false);assert.equal(one.wishlistPublic,false);
 const email=`Email_${tag}@example.test`;
 const mails=await Promise.allSettled([user({email}),user({email:email.toLowerCase()})]);
 assert.equal(mails.filter(r=>r.status==='fulfilled').length,1);
 assert.throws(()=>userInput({login:'api',email:'x@example.test'}));
 const u=userInput({login:' UsEr_AbC ',email:'Name+tag@EXAMPLE.TEST'});
 assert.equal(u.login,'user_abc');assert.equal(u.emailNormalized,'name+tag@example.test');
});
test('record DTO exact parity; owner IDs and technical columns never escape',async()=>{
 const {s}=await context();const actual=await s.createRecord(draft(record));
 assert.deepEqual(actual,{...record,id:actual.id});
 assert.deepEqual(Object.keys(actual).sort(),Object.keys(record).sort());
 const w=await s.createWishlistRecord({...wishDraft,artist:'Other'});
 assert.deepEqual(Object.keys(w).sort(),Object.keys(wish).sort());
 assert.equal(actual.id.length,36);
});
test('same album allowed across users, duplicate blocked within owner',async()=>{
 const a=await context(),b=await context();
 await a.s.createRecord(draft(record));await b.s.createRecord(draft(record));
 await assert.rejects(a.s.createRecord(draft(record)),fail('POTENTIAL_DUPLICATE',409));
 await assert.rejects(a.s.createWishlistRecord(wishDraft),fail('POTENTIAL_DUPLICATE',409));
 assert.equal((await b.s.getCollection()).length,1);
});
test('concurrent duplicate writes serialize per user, including Collection/Wishlist',async()=>{
 const {s}=await context();
 const results=await Promise.allSettled([s.createRecord(draft(record)),s.createRecord(draft(record))]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const c=await context();
 const outcomes=await Promise.allSettled([c.s.createWishlistRecord(wishDraft),c.s.createWishlistRecord(wishDraft)]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
});
test('incomplete edition remains potential not confirmed duplicate; normalization unchanged',async()=>{
 const {s}=await context();
 await s.createRecord({...draft(record),label:null});await s.createRecord({...draft(record),label:null});
 await s.createRecord({...draft(record),artist:'  Other   Artist  '});
 await assert.rejects(s.createRecord({...draft(record),artist:'other artist'}),fail('POTENTIAL_DUPLICATE'));
});
test('A cannot read/edit/delete/favorite/transfer B UUIDs or receive conflict details',async()=>{
 const a=await context(),b=await context(); const c=await b.s.createRecord(draft(record));
 const w=await b.s.createWishlistRecord({...wishDraft,artist:'Wishlist B'});
 assert.deepEqual(await a.s.getCollection(),[]);assert.equal(await recordRepository(pool,a.u.id,'collection').get(c.id),null);
 for(const operation of [()=>a.s.updateRecord(c.id,awaitless(c),draft(c)),()=>a.s.deleteRecord(c.id,awaitless(c)),()=>a.s.changeFavorite(c.id,awaitless(c),{favorite:true}),()=>a.s.transferRecord(w.id,'"'+'0'.repeat(64)+'"',purchase)]) {
  await assert.rejects(operation, error=>error.status===404 && Object.keys(error.details || {}).length===0);
 }
 assert.equal((await b.s.getCollection()).length,1);
 function awaitless(){return '"'+'0'.repeat(64)+'"';}
});
test('Wishlist A cannot update/delete B; raw scoped repo cannot overwrite B',async()=>{
 const a=await context(),b=await context();const w=await b.s.createWishlistRecord(wishDraft);const rev=await wishlistRevision(w);
 await assert.rejects(a.s.updateWishlistRecord(w.id,rev,wishDraft),fail('NOT_FOUND',404));
 await assert.rejects(a.s.deleteWishlistRecord(w.id,rev),fail('NOT_FOUND',404));
 await assert.rejects(recordRepository(pool,a.u.id,'wishlist').update(w,rev),fail('NOT_FOUND',404));
});
test('stale revision and concurrent updates: one writer wins, internal increment atomic',async()=>{
 const {s,u}=await context();const c=await s.createRecord(draft(record));const rev=await recordRevision(c);
 const outcomes=await Promise.allSettled([s.updateRecord(c.id,rev,{...draft(c),note:'one'}),s.updateRecord(c.id,rev,{...draft(c),note:'two'})]);
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(outcomes.find(r=>r.status==='rejected').reason.message,'RECORD_CHANGED');
 const row=(await pool.query('SELECT version,revision FROM vinyl.collection_records WHERE user_id=$1 AND id=$2',[u.id,c.id])).rows[0];
 assert.equal(row.version,'2');assert.equal(row.revision,await recordRevision((await s.getCollection())[0]));
 await assert.rejects(s.deleteRecord(c.id,rev),fail('RECORD_CHANGED'));
});
test('SQL injection input remains data; metadata/favorite do not erase cover',async()=>{
 const {u,s}=await context();const cover=randomUUID();await coverRepository(pool,u.id).insert(cover);
 const r={...record,id:randomUUID(),coverId:cover,artist:"x'); DROP TABLE vinyl.users; --"};
 await recordRepository(pool,u.id,'collection').insert(r);
 const favorite=await s.changeFavorite(r.id,await recordRevision(r),{favorite:true});
 const edited=await s.updateRecord(r.id,await recordRevision(favorite),{...draft(favorite),note:'edited'});
 assert.equal(edited.coverId,cover);assert.equal(edited.favorite,true);
 assert.equal((await pool.query('SELECT count(*) FROM vinyl.users')).rowCount,1);
});
test('composite cover FK and missing owner reject invalid references',async()=>{
 const a=await context(),b=await context();const cover=randomUUID();await coverRepository(pool,b.u.id).insert(cover);
 await assert.rejects(recordRepository(pool,a.u.id,'collection').insert({...record,id:randomUUID(),coverId:cover}), e=>e.code==='23503');
 await assert.rejects(recordRepository(pool,randomUUID(),'collection').insert({...record,id:randomUUID()}), e=>e.code==='23503');
 assert.equal(await coverRepository(pool,a.u.id).get(cover),null);
});
test('unlink/delete retains cover metadata for cleanup; shared references are not orphaned',async()=>{
 const {u,s}=await context();const cover=randomUUID();const cr=coverRepository(pool,u.id);await cr.insert(cover);
 const c={...record,id:randomUUID(),coverId:cover},w={...wish,id:randomUUID(),coverId:cover};
 await recordRepository(pool,u.id,'collection').insert(c);await recordRepository(pool,u.id,'wishlist').insert(w);
 await s.deleteRecord(c.id,await recordRevision(c));assert.deepEqual(await cr.unreferenced(),[]);
 await s.deleteWishlistRecord(w.id,await wishlistRevision(w));assert.deepEqual(await cr.unreferenced(),[{id:cover,storageKey:cover}]);
 await assert.rejects(pool.query('DELETE FROM vinyl.users WHERE id=$1',[u.id]), e=>e.code==='23503');
 assert.ok(await cr.get(cover));
});
test('user cascade deletes records/favorite but keeps login reservation (foundation only)',async()=>{
 const {s,u}=await context();await s.createRecord(draft(record));await s.createWishlistRecord({...wishDraft,artist:'Other'});
 await pool.query('DELETE FROM vinyl.users WHERE id=$1',[u.id]);
 assert.deepEqual(await s.getCollection(),[]);assert.deepEqual(await s.getWishlist(),[]);
 await assert.rejects(user({login:u.login}),e=>e.code==='23505');
});
test('transfer is atomic and preserves source metadata/cover; favorite defaults false',async()=>{
 const {s,u}=await context();const cover=randomUUID();await coverRepository(pool,u.id).insert(cover);
 const w={...wish,id:randomUUID(),coverId:cover};await recordRepository(pool,u.id,'wishlist').insert(w);
 const result=await s.transferRecord(w.id,await wishlistRevision(w),purchase);
 assert.equal(result.status,'complete');assert.equal(result.collectionRecord.coverId,cover);assert.equal(result.collectionRecord.favorite,false);
 assert.notEqual(result.collectionRecord.id,w.id);assert.equal(result.collectionRecord.purchasePrice,0);assert.deepEqual(await s.getWishlist(),[]);
});
test('transfer second-step failure rolls back inserted Collection',async()=>{
 const {s}=await context();const w=await s.createWishlistRecord(wishDraft);
 await pool.query(`CREATE FUNCTION vinyl.fail_delete_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$`);
 await pool.query(`CREATE TRIGGER fail_delete BEFORE DELETE ON vinyl.wishlist_records FOR EACH ROW EXECUTE FUNCTION vinyl.fail_delete_fixture()`);
 try { await assert.rejects(s.transferRecord(w.id,await wishlistRevision(w),purchase));assert.deepEqual(await s.getCollection(),[]);assert.deepEqual(await s.getWishlist(),[w]); }
 finally {await pool.query('DROP TRIGGER fail_delete ON vinyl.wishlist_records');await pool.query('DROP FUNCTION vinyl.fail_delete_fixture()');}
});
test('transfer rejects foreign target; explicit own matching target preserved',async()=>{
 const a=await context(),b=await context();const w=await a.s.createWishlistRecord(wishDraft);const c=await b.s.createRecord(draft(record));
 await assert.rejects(a.s.transferRecord(w.id,await wishlistRevision(w),{collectionId:c.id,collectionRevision:await recordRevision(c)}),fail('NOT_FOUND'));
 const own=await a.s.createRecord(draft(record));
 await assert.rejects(a.s.transferRecord(w.id,await wishlistRevision(w),purchase),fail('POTENTIAL_DUPLICATE'));
 const result=await a.s.transferRecord(w.id,await wishlistRevision(w),{collectionId:own.id,collectionRevision:await recordRevision(own)});
 assert.deepEqual(result.collectionRecord,own);assert.equal((await a.s.getCollection()).length,1);
});
test('import dry-run writes nothing; repeat/no-op and changed manifest conflict',async()=>{
 const snap=snapshot();const report=await importSnapshot(pool,snap);
 assert.equal(report.status,'validated');assert.equal((await pool.query('SELECT id FROM vinyl.users WHERE id=$1',[snap.user.id])).rowCount,0);
 const results=await Promise.all([importSnapshot(pool,snap,{dryRun:false}),importSnapshot(pool,snap,{dryRun:false})]);
 assert.deepEqual(results.map(r=>r.status).sort(),['already_imported','imported']);
 await assert.rejects(importSnapshot(pool,{...snap,collection:[]},{dryRun:false}),/manifest conflict/);
 assert.deepEqual(await recordRepository(pool,snap.user.id,'collection').list(),snap.collection);
});
test('import failure leaves no partial user/marker; missing covers rejected in dry-run',async()=>{
 const snap=snapshot();await importSnapshot(pool,snap,{dryRun:false});
 const next=snapshot({collection:snap.collection});
 await assert.rejects(importSnapshot(pool,next,{dryRun:false}),e=>e.code==='23505');
 assert.equal((await pool.query('SELECT id FROM vinyl.users WHERE id=$1',[next.user.id])).rowCount,0);
 assert.equal((await pool.query('SELECT import_key FROM vinyl.data_imports WHERE import_key=$1',[next.importKey])).rowCount,0);
 await assert.rejects(importSnapshot(pool,snapshot({collection:[{...record,coverId:randomUUID()}]})),/Missing cover/);
});
test('import preserves non-rounded price, zero/null, calendar year 0000 and favorites',async()=>{
 const snap=snapshot({collection:[{...record,id:randomUUID(),purchaseDate:'0000-01-01',purchasePrice:1.12345,favorite:true}]});
 const result=await importSnapshot(pool,snap,{dryRun:false});assert.equal(result.favorites,1);
 assert.deepEqual(await recordRepository(pool,snap.user.id,'collection').list(),snap.collection);
});
test('JS sort/search/favorite filter/CSV and public projection remain unchanged',async()=>{
 const snap=snapshot({collection:[{...record,id:randomUUID(),artist:'alpha',album:'First',favorite:true},
 {...record,id:randomUUID(),artist:'Alpha',album:'Second',purchasePrice:0},
 {...record,id:randomUUID(),artist:'Beta',albumYear:'1980',note:'=1+1'}]});
 await importSnapshot(pool,snap,{dryRun:false});const loaded=await recordRepository(pool,snap.user.id,'collection').list();
 assert.deepEqual(sortRecords(loaded),sortRecords(snap.collection));
 assert.deepEqual(searchCollection(loaded,{favoriteOnly:true}),[snap.collection[0]]);
 assert.deepEqual(searchCollection(loaded,{artist:'ALPHA'}),snap.collection.slice(0,2));
 const cols=[['artist','Artist'],['album','Album'],['note','Note'],['purchasePrice','Price']];
 assert.equal(recordsCsv(sortRecords(loaded),cols),recordsCsv(sortRecords(snap.collection),cols));
 for(const r of publicRecords(loaded)) for(const key of ['id','user_id','purchasePrice','purchaseStore','purchaseDate','coverId','version','position']) assert.equal(Object.hasOwn(r,key),false);
});
test('DB unavailable rejects boundedly without source fallback',async()=>{
 const url=new URL(process.env.DATABASE_URL);url.port='1';const offline=createPool(url.href);
 try {await assert.rejects(createPostgresServices(offline,randomUUID()).getCollection());}finally{await offline.end();}
});
test('real HTTP PG bridge: guest projection, owner CRUD/favorite/cover/transfer and logout',async t=>{
 const u=await user({collectionPublic:true,wishlistPublic:true});
 const dir=await mkdtemp(join(tmpdir(),'vinyl-pg-http-'));const storage=createCoverStorage(dir);const s=createPostgresServices(pool,u.id,storage);
 const server=createApp(s,{auth:testAuth()});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await rm(dir,{recursive:true,force:true});});
 const url=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await fetch(url+'/api/collection',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:JSON.stringify(draft(record))})).status,401);
 const headers=await loginOwner(url);
 const request=(path,method,body,extra={})=>fetch(url+path,{method,headers:{...headers,'Content-Type':'application/json',...extra},body:body===undefined?undefined:JSON.stringify(body)});
 const created=await request('/api/collection','POST',draft(record));assert.equal(created.status,201);let c=await created.json();
 const guest=await (await fetch(url+'/api/collection')).json();assert.deepEqual(guest,publicRecords([c]));
 let changed=await request(`/api/collection/${c.id}`,'PUT',{...draft(c),note:'HTTP edited'},{'If-Match':await recordRevision(c)});assert.equal(changed.status,200);c=await changed.json();
 changed=await request(`/api/collection/${c.id}/favorite`,'PATCH',{favorite:true},{'If-Match':await recordRevision(c)});assert.equal(changed.status,200);c=await changed.json();
 const bytes=await sharp({create:{width:32,height:32,channels:3,background:'#ffaa22'}}).png().toBuffer();
 const upload=await fetch(`${url}/api/collection/${c.id}/cover`,{method:'PUT',headers:{...headers,'Content-Type':'image/png','If-Match':await recordRevision(c)},body:bytes});assert.equal(upload.status,200);c=await upload.json();
 assert.ok(c.coverId);assert.equal((await fetch(`${url}/media/covers/${c.coverId}/thumb.webp`)).status,200);
 const wr=await request('/api/wishlist','POST',{...wishDraft,artist:'HTTP Transfer'});assert.equal(wr.status,201);const w=await wr.json();
 const tr=await request(`/api/wishlist/${w.id}/transfer`,'POST',purchase,{'If-Match':await wishlistRevision(w)});assert.equal(tr.status,200);assert.equal((await tr.json()).status,'complete');
 assert.equal((await request(`/api/collection/${c.id}`,'DELETE',undefined,{'If-Match':await recordRevision(c)})).status,200);
 assert.equal((await request('/api/auth/logout','POST',{})).status,200);
 assert.equal((await request('/api/collection','POST',draft(record))).status,401);
});


test('cover mutation cannot prepare files for another owner; stale cover revision rejected',async()=>{
 const a=await context(),b=await context();const c=await b.s.createRecord(draft(record));let prepared=0;
 const s=createPostgresServices(pool,a.u.id,{prepare:async()=>{prepared++;return randomUUID();}});
 await assert.rejects(s.changeCover('collection',c.id,await recordRevision(c),Buffer.from('x')),fail('NOT_FOUND'));
 assert.equal(prepared,0);
 const own=await a.s.createRecord(draft(record));
 await a.s.changeFavorite(own.id,await recordRevision(own),{favorite:true});
 await assert.rejects(s.changeCover('collection',own.id,await recordRevision(own),null),fail('RECORD_CHANGED'));
});
test('foreign ownerId payload rejected; upper UUID lookup and imported identity canonicalized',async()=>{
 const {s}=await context();await assert.rejects(s.createRecord({...draft(record),user_id:randomUUID()}),fail('INVALID_RECORD'));
 const snap=snapshot({collection:[{...record,id:randomUUID().toUpperCase()}]});
 const report=await importSnapshot(pool,snap,{dryRun:false});assert.equal(report.canonicalizedIds,1);
 const r=await recordRepository(pool,snap.user.id,'collection').get(snap.collection[0].id);
 assert.equal(r.id,snap.collection[0].id.toLowerCase());
 const stored=(await pool.query('SELECT revision FROM vinyl.collection_records WHERE id=$1',[r.id])).rows[0];
 assert.equal(stored.revision,await recordRevision(r));
});
test('raw Sheets fixture mapping imports null/false, both lists and cover inventory',async()=>{
 const {SHEETS_COLUMNS}=await import('../../server/google-sheets-collection.mjs');
 const {WISHLIST_COLUMNS}=await import('../../server/google-sheets-wishlist.mjs');
 const cover=randomUUID();const c={...record,id:randomUUID(),coverId:cover,purchaseDate:null,purchasePrice:0,favorite:false};
 const w={...wish,id:randomUUID(),coverId:cover};
 const values=(columns,r)=>[Object.keys(columns),Object.values(columns).map(field=>r[field]===null || field==='favorite'?'':r[field])];
 const snap=snapshot({collectionValues:values(SHEETS_COLUMNS,c),wishlistValues:values(WISHLIST_COLUMNS,w),covers:[cover]});
 delete snap.collection; delete snap.wishlist;
 const report=await importSnapshot(pool,snap,{dryRun:false});assert.equal(report.covers,1);
 assert.deepEqual(await recordRepository(pool,snap.user.id,'collection').list(),[c]);
 assert.deepEqual(await recordRepository(pool,snap.user.id,'wishlist').list(),[w]);
});

test('import rejects ambiguous representations before touching the database', async()=>{
 const snap=snapshot({collectionValues:[]});
 await assert.rejects(importSnapshot(pool,snap,{dryRun:false}),/Exactly one input/);
 assert.equal((await pool.query('SELECT id FROM vinyl.users WHERE id=$1',[snap.user.id])).rowCount,0);
});
test('production PG startup is rejected before listening or accessing storage',async()=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 await assert.rejects(promisify(execFile)(process.execPath,['server/index.mjs'],{cwd:new URL('../../',import.meta.url),env:{NODE_ENV:'production',DATA_BACKEND:'postgres'},timeout:4000}),e=>e.code===1 && !e.stdout.includes('http://'));
});

function mirrorFixture(){const data={collection:[],wishlist:[]};return {data,read:async s=>structuredClone(data[s]),replace:async(s,r)=>{data[s]=structuredClone(r);}};}
test('4B explicit production config and mirror config fail closed',()=>{
 const env={NODE_ENV:'production',DATA_BACKEND:'postgres',PG_PRODUCTION_ACK:'stage4b',DATABASE_URL:'postgresql://vinyl_app:placeholder@127.0.0.1:5432/vinyl_production',PG_OWNER_ID:randomUUID()};
 assert.equal(backendConfiguration(env).ownerId,env.PG_OWNER_ID);
 for(const change of [{PG_PRODUCTION_ACK:''},{PG_OWNER_ID:''},{DATABASE_URL:env.DATABASE_URL.replace('127.0.0.1','remote')},{DATABASE_URL:env.DATABASE_URL.replace('vinyl_app','postgres')}])assert.throws(()=>backendConfiguration({...env,...change}));
 assert.throws(()=>mirrorConfiguration({...env,MIRROR_ENABLED:'true',MIRROR_OWNER_ID:randomUUID()},backendConfiguration(env)));
 assert.throws(()=>mirrorConfiguration({...env,MIRROR_ENABLED:'true',MIRROR_OWNER_ID:env.PG_OWNER_ID,MIRROR_FAKE_FILE:'/tmp/mirror.json'},backendConfiguration(env)));
 assert.throws(()=>mirrorConfiguration({...env,MIRROR_ENABLED:'false',MIRROR_OWNER_ID:env.PG_OWNER_ID},backendConfiguration(env)));
});
test('4B HTTP media GET/HEAD denies private, foreign and orphan; guest list privacy',async t=>{
 const a=await user(),b=await user();const dir=await mkdtemp(join(tmpdir(),'vinyl-boundary-'));const storage=createCoverStorage(dir);
 const image=await sharp({create:{width:16,height:16,channels:3,background:'#ffee00'}}).png().toBuffer();
 const own=await storage.prepare(image),foreign=await storage.prepare(image),orphan=await storage.prepare(image);
 await coverRepository(pool,a.id).insert(own);await coverRepository(pool,a.id).insert(orphan);await coverRepository(pool,b.id).insert(foreign);
 await recordRepository(pool,a.id,'collection').insert({...record,id:randomUUID(),coverId:own});
 await recordRepository(pool,b.id,'collection').insert({...record,id:randomUUID(),coverId:foreign});
 const server=createApp(createPostgresServices(pool,a.id,storage),{auth:testAuth()});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{await new Promise(r=>{server.close(r);server.closeAllConnections();});await rm(dir,{recursive:true,force:true});});
 const url=`http://127.0.0.1:${server.address().port}`,headers=await loginOwner(url);
 assert.equal((await fetch(url+'/api/collection')).status,404);
 for(const method of ['GET','HEAD']) {
  assert.equal((await fetch(`${url}/media/covers/${own}/thumb.webp`,{method})).status,404);
  const allowed=await fetch(`${url}/media/covers/${own}/thumb.webp`,{method,headers});assert.equal(allowed.status,200);assert.equal(allowed.headers.get('cache-control'),'private, no-store');
  for(const id of [foreign,orphan])assert.equal((await fetch(`${url}/media/covers/${id}/thumb.webp`,{method,headers})).status,404);
 }
 await pool.query('UPDATE vinyl.users SET collection_public=true WHERE id=$1',[a.id]);
 assert.equal((await fetch(`${url}/media/covers/${own}/image.webp`)).status,200);
 assert.equal((await fetch(url+'/api/collection')).status,200);
 await assert.rejects(ownerBoundary({query:async()=>{throw Error('offline');}},a.id).authorizeCover(own,null));
});
test('4B public wishlist reference authorizes shared cover even if collection private',async()=>{
 const u=await user({wishlistPublic:true});const cover=randomUUID();await coverRepository(pool,u.id).insert(cover);
 await recordRepository(pool,u.id,'collection').insert({...record,id:randomUUID(),coverId:cover});
 await recordRepository(pool,u.id,'wishlist').insert({...wish,id:randomUUID(),coverId:cover});
 await ownerBoundary(pool,u.id).authorizeCover(cover,null);
 await pool.query('UPDATE vinyl.users SET wishlist_public=false WHERE id=$1',[u.id]);
 await assert.rejects(ownerBoundary(pool,u.id).authorizeCover(cover,null),fail('NOT_FOUND'));
});
test('4B generation commits with business mutation and rolls back on failure',async()=>{
 const {u,s}=await context();await enableMirror(pool,u.id);const initial=await mirrorStatus(pool,u.id);
 await s.createRecord(draft(record));assert.equal((await mirrorStatus(pool,u.id)).generation,String(BigInt(initial.generation)+1n));
 await assert.rejects(s.createRecord(draft(record)));assert.equal((await mirrorStatus(pool,u.id)).generation,'2');
 const other=await context();await other.s.createRecord(draft(record));assert.equal((await mirrorStatus(pool,u.id)).generation,'2');
});
test('4B Google failure cannot undo successful PG; retry state survives new pool',async()=>{
 const {u,s}=await context();await enableMirror(pool,u.id);const saved=await s.createRecord(draft(record));
 const bad={read:async()=>{throw Error('secret remote error');},replace:async()=>{throw Error('secret remote error');}};
 assert.equal((await reconcile(pool,u.id,bad)).status,'failed');assert.deepEqual(await s.getCollection(),[saved]);
 const second=createPool(process.env.DATABASE_URL);try{const state=await mirrorStatus(second,u.id);assert.equal(state.last_error,'MIRROR_SYNC_FAILED');assert.ok(new Date(state.next_attempt_at)>new Date());assert.equal((await reconcile(second,u.id,bad)).status,'waiting');}finally{await second.end();}
 assert.equal((await reconcile(pool,u.id,mirrorFixture(),{force:true})).status,'verified');
});
test('4B partial two-sheet failure retains pending; reconciliation repairs manual drift',async()=>{
 const {u,s}=await context();await enableMirror(pool,u.id);await s.createRecord(draft(record));await s.createWishlistRecord({...wishDraft,artist:'different'});
 const fixture=mirrorFixture(),replace=fixture.replace;fixture.replace=async(s,r)=>{if(s==='wishlist')throw Error('outage');await replace(s,r);};
 assert.equal((await reconcile(pool,u.id,fixture)).status,'failed');assert.equal((await mirrorStatus(pool,u.id)).synced_generation,'0');assert.equal(fixture.data.collection.length,1);
 fixture.replace=replace;await reconcile(pool,u.id,fixture,{force:true});assert.equal((await mirrorStatus(pool,u.id)).status,'synced');
 fixture.data.collection=[];await reconcile(pool,u.id,fixture,{force:true});assert.equal(fixture.data.collection.length,1);
 assert.deepEqual(await s.getCollection(),fixture.data.collection);
});
test('4B concurrent generation is not marked synced and parallel writer is excluded',async()=>{
 const {u,s}=await context();await enableMirror(pool,u.id);await s.createRecord(draft(record));const fixture=mirrorFixture(),replace=fixture.replace;let onceOnly=true;
 fixture.replace=async(section,rows)=>{if(onceOnly){onceOnly=false;assert.equal((await reconcile(pool,u.id,mirrorFixture(),{force:true})).status,'busy');await s.createRecord({...draft(record),artist:'during sync'});}await replace(section,rows);};
 const first=await reconcile(pool,u.id,fixture);assert.equal(first.status,'verified');assert.equal((await mirrorStatus(pool,u.id)).status,'pending');
 await reconcile(pool,u.id,fixture);assert.equal((await mirrorStatus(pool,u.id)).status,'synced');assert.equal(fixture.data.collection.length,2);
});
test('4B read-back mismatch does not advance synced generation',async()=>{
 const {u,s}=await context();await enableMirror(pool,u.id);await s.createRecord(draft(record));
 const result=await reconcile(pool,u.id,{read:async()=>[],replace:async()=>{}});
 assert.equal(result.error,'MIRROR_VERIFY_FAILED');assert.equal((await mirrorStatus(pool,u.id)).synced_generation,'0');
});
test('4B writes after a synced mirror wake hourly schedule',async()=>{
 const {u,s}=await context();await enableMirror(pool,u.id);const fixture=mirrorFixture();await reconcile(pool,u.id,fixture);
 assert.equal((await reconcile(pool,u.id,fixture)).status,'waiting');await s.createRecord(draft(record));
 assert.equal((await reconcile(pool,u.id,fixture)).status,'verified');
});
test('4B freeze drains transactions, blocks new mutations, preserves reads',async()=>{
 const {u,s}=await context();let release;const held=new Promise(r=>release=r);let entered;const ready=new Promise(r=>entered=r);
 const writer=ownerTransaction(pool,u.id,async()=>{entered();await held;});await ready;
 let drained=false;const freezing=freeze(pool,true).then(r=>{drained=true;return r;});await new Promise(r=>setTimeout(r,30));assert.equal(drained,false);release();await writer;
 try{assert.equal((await freezing).drained,true);await assert.rejects(s.createRecord(draft(record)),fail('WRITES_FROZEN',503));assert.deepEqual(await s.getCollection(),[]);}finally{await freeze(pool,false);}
});
test('4B imported revisions verify and support subsequent mutations',async()=>{
 const snap=snapshot();await importSnapshot(pool,snap,{dryRun:false});assert.equal((await verifyImport(pool,snap)).verified,true);
 const s=createPostgresServices(pool,snap.user.id);const current=(await s.getCollection())[0];
 const edited=await s.updateRecord(current.id,await recordRevision(snap.collection[0]),{...draft(current),note:'after import'});
 const fav=await s.changeFavorite(edited.id,await recordRevision(edited),{favorite:true});await s.deleteRecord(fav.id,await recordRevision(fav));
 assert.equal((await verifyImport(pool,snap)).verified,false);
});
test('4B rollback gate refuses unfrozen or stale Sheets',async()=>{
 const {u,s}=await context();await s.createRecord(draft(record));const fixture=mirrorFixture();
 await assert.rejects(rollbackGate(pool,u.id,fixture),/Freeze/);await freeze(pool,true);
 try{assert.equal((await rollbackGate(pool,u.id,fixture)).verified,false);fixture.data.collection=await s.getCollection();assert.equal((await rollbackGate(pool,u.id,fixture)).verified,true);}finally{await freeze(pool,false);}
});
test('4B Sheets adapter uses typed values and clears stale tail in one batch',async()=>{
 const {SHEETS_COLUMNS}=await import('../../server/google-sheets-collection.mjs');const headers=Object.keys(SHEETS_COLUMNS);const calls=[];
 const auth={getClient:async()=>({request:async options=>{calls.push(options);if(options.method==='POST')return {data:{}};if(options.url.includes('/values/'))return {data:{values:[headers,[],[],[]]}};return {data:{sheets:[{properties:{title:'Data',sheetId:7,gridProperties:{rowCount:20}}}]}};}})};
 const adapter=sheetsMirror({targets:{collection:{id:'fixture',name:'Data'}}},auth);
 await adapter.replace('collection',[{...record,artist:'=IMPORTXML("x")',purchasePrice:0,favorite:false}]);
 const post=calls.find(c=>c.method==='POST');assert.equal(post.data.requests.length,1);const update=post.data.requests[0].updateCells;
 assert.equal(update.range.endRowIndex,4);assert.equal(update.rows.length,2);assert.deepEqual(update.rows[1].values[1],{userEnteredValue:{stringValue:'=IMPORTXML("x")'}});
 assert.deepEqual(update.rows[1].values[12],{userEnteredValue:{numberValue:0}});assert.deepEqual(update.rows[1].values[14],{userEnteredValue:{boolValue:false}});
 assert.equal(update.fields,'userEnteredValue');assert.equal(calls[1].params.valueRenderOption,'UNFORMATTED_VALUE');
});
test('4B backup refuses unfrozen database and overwrite',async()=>{
 const {u}=await context();const dir=await mkdtemp(join(tmpdir(),'vinyl-backup-test-'));
 try{await assert.rejects(createBackup(pool,{url:process.env.DATABASE_URL,bin:'/unused',directory:join(dir,'backup'),covers:dir,userId:u.id}),/Separate/);
 await assert.rejects(createBackup(pool,{url:process.env.DATABASE_URL,bin:'/unused',directory:dir,covers:'/tmp/separate-covers',userId:u.id}),/Freeze/);
 await freeze(pool,true);try{await assert.rejects(createBackup(pool,{url:process.env.DATABASE_URL,bin:'/unused',directory:dir,covers:'/tmp/separate-covers',userId:u.id}),e=>e.code==='EEXIST');}finally{await freeze(pool,false);}
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('4B unavailable DB denies HTTP media before touching filesystem',async t=>{
 let reads=0;const boundary=ownerBoundary({query:async()=>{throw Error('database offline');}},randomUUID());
 const server=createApp({...boundary,coverStorage:{read:async()=>{reads++;return Buffer.from('private');}}},{auth:testAuth()});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const response=await fetch(`http://127.0.0.1:${server.address().port}/media/covers/${randomUUID()}/image.webp`);
 assert.equal(response.status,500);assert.equal(reads,0);assert.ok(!(await response.text()).includes('database offline'));
});
test('4B full reconciliation checks clean mirror after periodic deadline',async()=>{
 const {u,s}=await context();await enableMirror(pool,u.id);await s.createRecord(draft(record));const fixture=mirrorFixture();await reconcile(pool,u.id,fixture);
 fixture.data.collection=[];await pool.query("UPDATE vinyl.mirror_state SET next_attempt_at=now()-interval '1 second' WHERE user_id=$1",[u.id]);
 assert.equal((await reconcile(pool,u.id,fixture)).status,'verified');assert.equal(fixture.data.collection.length,1);
});
test('4B failed business transaction rolls back both data and dirty generation',async()=>{
 const {u}=await context();await enableMirror(pool,u.id);
 await assert.rejects(ownerTransaction(pool,u.id,async c=>{await recordRepository(c,u.id,'collection').insert({...record,id:randomUUID()});throw Error('failure after write');}));
 assert.equal((await mirrorStatus(pool,u.id)).generation,'1');assert.deepEqual(await recordRepository(pool,u.id,'collection').list(),[]);
});
test('4B fresh CLI process observes and reconciles durable pending state without Google',async()=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const exec=promisify(execFile);
 const {u,s}=await context();await enableMirror(pool,u.id);await s.createRecord(draft(record));const dir=await mkdtemp(join(tmpdir(),'vinyl-worker-'));const file=join(dir,'mirror.json');await writeFile(file,JSON.stringify({collection:[],wishlist:[]}));
 const env={PATH:process.env.PATH,NODE_ENV:'test',DATA_BACKEND:'postgres',DATABASE_URL:process.env.DATABASE_URL,PG_OWNER_ID:u.id,MIRROR_ENABLED:'true',MIRROR_OWNER_ID:u.id,MIRROR_FAKE_FILE:file};
 try{const before=await exec(process.execPath,['scripts/pg-mirror.mjs','status'],{env});assert.equal(JSON.parse(before.stdout).status,'pending');
 const result=await exec(process.execPath,['scripts/pg-mirror.mjs','reconcile'],{env});assert.equal(JSON.parse(result.stdout).status,'verified');assert.equal(JSON.parse(await readFile(file,'utf8')).collection.length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('4B least-privilege runtime grants support owner row lock and mutations without DDL',async()=>{
 const {u}=await context();await enableMirror(pool,u.id);const client=await pool.connect();const role='vinyl_fixture_'+randomUUID().replaceAll('-','');
 try {
  await client.query('BEGIN');await client.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE`);
  await client.query(`GRANT USAGE ON SCHEMA vinyl TO ${role}`);await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA vinyl TO ${role}`);
  await client.query(`GRANT INSERT,UPDATE,DELETE ON vinyl.collection_records,vinyl.wishlist_records TO ${role}`);
  await client.query(`GRANT INSERT ON vinyl.covers TO ${role}`);await client.query(`GRANT UPDATE(updated_at) ON vinyl.users TO ${role}`);
  await client.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA vinyl TO ${role}`);
  await client.query(`GRANT UPDATE(business_writes) ON vinyl.runtime_control TO ${role}`);
  await client.query(`GRANT UPDATE(generation,dirty_since,next_attempt_at) ON vinyl.mirror_state TO ${role}`);
  await client.query(`SET LOCAL ROLE ${role}`);
  assert.equal((await client.query("SELECT has_schema_privilege(current_user,'vinyl','CREATE') AS allowed")).rows[0].allowed,false);
  await client.query('SELECT id FROM vinyl.users WHERE id=$1 FOR UPDATE',[u.id]);
  const r=await recordRepository(client,u.id,'collection').insert({...record,id:randomUUID()});
  await recordRepository(client,u.id,'collection').update({...r,note:'restricted runtime'},await recordRevision(r));
  await client.query('UPDATE vinyl.runtime_control SET business_writes=business_writes+1 WHERE singleton');
  await client.query('UPDATE vinyl.mirror_state SET generation=generation+1,dirty_since=clock_timestamp(),next_attempt_at=clock_timestamp() WHERE user_id=$1',[u.id]);
 }finally{await client.query('ROLLBACK');client.release();}
 assert.equal((await pool.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount,0);
});
