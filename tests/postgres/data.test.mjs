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
 assert.equal((await pool.query('SELECT count(*) FROM vinyl.schema_migrations')).rows[0].count,'1');
});
test('migration checksum mismatch and failed DDL never become successful',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'vinyl-migration-test-'));const url=pathToFileURL(dir+'/');
 try {
  const first=await readFile(new URL('001_data_foundation.sql',migrationDirectory),'utf8');
  await writeFile(join(dir,'001_data_foundation.sql'),first+'\n-- changed');
  await assert.rejects(migrate(pool,url),/checksum/);
  await writeFile(join(dir,'001_data_foundation.sql'),first);
  await writeFile(join(dir,'002_failure.sql'),'CREATE TABLE vinyl.must_rollback(id int); SELECT 1/0;');
  await assert.rejects(migrate(pool,url));
  assert.equal((await pool.query("SELECT to_regclass('vinyl.must_rollback') AS name")).rows[0].name,null);
  assert.equal((await pool.query('SELECT count(*) FROM vinyl.schema_migrations')).rows[0].count,'1');
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
