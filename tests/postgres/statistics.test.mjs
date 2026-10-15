import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {createPool} from '../../server/postgres/config.mjs';
import {migrate} from '../../server/postgres/migrations.mjs';
import {requireTestDatabase} from './safety.mjs';
import {createStatistics,createStatisticsReporter} from '../../server/statistics.mjs';
import {createAuthStore,transaction} from '../../server/security/auth-store.mjs';
import {createPostgresServices} from '../../server/postgres/services.mjs';
import {scopedServices} from '../../server/security/scoped-services.mjs';
import {createApp} from '../../server/app.mjs';
import {record} from '../fixtures/collection.mjs';
import {wish,wishDraft} from '../fixtures/wishlist.mjs';
import {wishlistRevision} from '../../src/wishlist-record.mjs';
import {recordRevision} from '../../src/collection-record.mjs';
import {authGrants} from '../../server/security/grants.mjs';
const {id:fixtureId,coverId:fixtureCover,favorite:fixtureFavorite,...recordDraft}=record;
const pool=createPool(process.env.DATABASE_URL);let clock,stats;
const reset=async()=>{await pool.query("DELETE FROM vinyl.bug_report_deliveries WHERE user_id IN (SELECT id FROM vinyl.users WHERE login LIKE 'stat_%')");return pool.query('TRUNCATE vinyl.statistics_reports,vinyl.statistics_user_days,vinyl.statistics_daily,vinyl.statistics_state');};
before(async()=>{await requireTestDatabase(pool);await migrate(pool);});after(async()=>{await reset();await pool.end();});
beforeEach(async()=>{await reset();clock=Date.parse('2026-10-14T20:59:00Z');stats=createStatistics(pool,{now:()=>clock});await stats.initialize();});
const tag=()=>randomUUID().replaceAll('-','').slice(0,16),password='Local statistics fixture alpha';
async function account(){const messages=[],ip=tag(),store=await createAuthStore({pool,secret:randomBytes(32).toString('hex'),registrationEnabled:true,statistics:stats,emailService:{send:async m=>{messages.push(m);return 'accepted';}}});const login='stat_'+tag();const flow=await store.start('registration',{login,email:login+'@example.test'},ip);await store.flushMail();const verified=await store.verify(flow.token,messages.at(-1).code,ip);await store.complete(verified.token,{password,repeat:password},ip);const result=await store.login({login,password},ip);return {store,session:await store.session(result.token)};}
const counts=async day=>(await pool.query('SELECT * FROM vinyl.statistics_daily WHERE day=$1',[day])).rows[0];
const reporter=mail=>createStatisticsReporter(pool,{mail,recipient:'obratsev@yandex.ru',now:()=>clock});
test('event counters are atomic, survive deletion, do not backfill; views dedup by actor/day across sections',async()=>{
 const a=await account(),b=await account();assert.equal((await counts('2026-10-14')).registrations,'2');
 const services=createPostgresServices(pool,a.session.userId,null,null,stats);
 const c=await services.createRecord({...recordDraft,artist:'Stats create'});await services.createWishlistRecord({...wishDraft,artist:'Stats wish'});
 await assert.rejects(services.createRecord({...recordDraft,artist:'Stats create'}));
 await assert.rejects(transaction(pool,async client=>{await stats.count(client,'collection_added');throw Error('rollback');}));
 assert.equal((await counts('2026-10-14')).collection_added,'1');
 await Promise.all([stats.view(a.session),stats.view(a.session),stats.view(b.session),stats.view(null)]);
 assert.equal((await counts('2026-10-14')).active_users,'2');
 clock=Date.parse('2026-10-14T21:00:00Z');await stats.view(a.session);assert.equal((await counts('2026-10-15')).active_users,'1');
 await services.deleteRecord(c.id,await recordRevision(c));assert.equal((await counts('2026-10-14')).collection_added,'1');
 await pool.query('DELETE FROM vinyl.users WHERE id=$1',[b.session.userId]);assert.equal((await counts('2026-10-14')).active_users,'2');
 assert.equal((await pool.query('SELECT 1 FROM vinyl.statistics_user_days WHERE user_id=$1',[b.session.userId])).rowCount,0);
});
test('new transfer target counts once; import/direct repository paths do not count',async()=>{
 const a=await account(),s=createPostgresServices(pool,a.session.userId,null,null,stats);
 const w=await s.createWishlistRecord({...wishDraft,artist:'Transfer statistics'});
 await s.transferRecord(w.id,await wishlistRevision(w),{purchaseDate:null,purchaseStore:null,purchasePrice:null});
 const row=await counts('2026-10-14');assert.equal(row.collection_added,'1');assert.equal(row.wishlist_added,'1');
 await assert.rejects(s.transferRecord(w.id,await wishlistRevision(w),{purchaseDate:null,purchaseStore:null,purchasePrice:null}));assert.equal((await counts('2026-10-14')).collection_added,'1');
 const plain=createPostgresServices(pool,a.session.userId);await plain.createRecord({...recordDraft,artist:'Untracked import fixture'});assert.equal((await counts('2026-10-14')).collection_added,'1');
});
test('HTTP: marked successful authenticated views count viewer, not viewed owner; guest/checks/private/error/HEAD do not count',async()=>{
 const a=await account(),b=await account();await pool.query('UPDATE vinyl.users SET collection_public=true,wishlist_public=true WHERE id=$1',[b.session.userId]);
 let current=null;const server=createApp({}, {auth:{session:async()=>current,limit(){},ready:async()=>{}},servicesForSession:scopedServices(pool,b.session.userId,null,stats),onListView:stats.view});server.listen(0,'127.0.0.1');await once(server,'listening');const url='http://127.0.0.1:'+server.address().port,headers={'X-Collection-View':'1'};
 try{
  assert.equal((await fetch(url+'/api/u/'+b.session.login+'/collection',{headers})).status,200);
  current=a.session;assert.equal((await fetch(url+'/api/u/'+b.session.login+'/collection')).status,200);
  assert.equal((await fetch(url+'/api/u/'+b.session.login+'/collection',{method:'HEAD',headers})).status,200);
  assert.equal((await pool.query('SELECT * FROM vinyl.statistics_user_days')).rowCount,0);
  for(const section of ['collection','wishlist'])assert.equal((await fetch(url+'/api/u/'+b.session.login+'/'+section,{headers})).status,200);
  assert.equal((await counts('2026-10-14')).active_users,'1');assert.equal((await pool.query('SELECT user_id FROM vinyl.statistics_user_days')).rows[0].user_id,a.session.userId);
  current=b.session;assert.equal((await fetch(url+'/api/u/'+a.session.login+'/collection',{headers})).status,403);
  assert.equal((await fetch(url+'/api/u/unknown_fixture/collection',{headers})).status,404);assert.equal((await counts('2026-10-14')).active_users,'1');
  await pool.query('UPDATE vinyl.auth_sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1',[b.session.tokenDigest]);
  assert.equal((await fetch(url+'/api/u/'+b.session.login+'/collection',{headers})).status,401);assert.equal((await counts('2026-10-14')).active_users,'1');
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('daily snapshot excludes old/future reports, marks partial start, survives repeats and concurrency',async()=>{
 const a=await account();await stats.view(a.session);
 for(const [stamp,text]of[['2026-10-14T20:58:00Z','old'],['2026-10-14T20:59:30Z','new'],['2026-10-14T21:00:00Z','next']])await pool.query(`INSERT INTO vinyl.bug_report_deliveries(id,user_id,request_id,text,section,mail_state,created_at) VALUES($1,$2,$3,$4,'collection','disabled',$5)`,[randomUUID(),a.session.userId,randomUUID(),text,stamp]);
 clock=Date.parse('2026-10-15T07:00:00Z');const mail=[];const job=reporter({sendStatistics:async message=>{mail.push(message);return 'accepted';}});
 const results=await Promise.all([job.run(),job.run()]);assert.equal(mail.length,1);assert.ok(results.some(r=>r.state==='sent'));
 await job.run();assert.equal(mail.length,1);const p=mail[0].payload;assert.equal(p.day,'2026-10-14');assert.equal(p.bug_reports,1);assert.equal(p.active_users,1);assert.equal(p.registrations,1);assert.equal(p.partial,true);
 assert.ok(!JSON.stringify(p).includes(a.session.userId));assert.equal((await pool.query('SELECT count(*) FROM vinyl.statistics_reports')).rows[0].count,'1');
});
test('confirmed SMTP failure retries same snapshot at most three times, early/repeated timer cannot duplicate',async()=>{
 clock=Date.parse('2026-10-15T07:00:00Z');let calls=0;const job=reporter({sendStatistics:async()=>{calls++;return 'failed';}});
 assert.equal((await job.run()).state,'pending');await job.run();assert.equal(calls,1);
 clock+=5*60000;assert.equal((await job.run()).state,'pending');clock+=5*60000;assert.equal((await job.run()).state,'failed');clock+=5*60000;await job.run();assert.equal(calls,3);
});
test('SMTP unknown/thrown outcome and crashed sending are never automatically replayed',async()=>{
 clock=Date.parse('2026-10-15T07:00:00Z');let calls=0;const job=reporter({sendStatistics:async()=>{calls++;throw Error('secret provider detail');}});
 assert.equal((await job.run()).state,'unknown');clock+=5*60000;await job.run();assert.equal(calls,1);
 await pool.query("UPDATE vinyl.statistics_reports SET state='sending'");await job.run();assert.equal(calls,1);assert.equal((await pool.query('SELECT state,last_error FROM vinyl.statistics_reports')).rows[0].last_error,'DELIVERY_UNKNOWN');
});
test('least privilege existing runtime/backup grants cover new accounting and reporting tables',async()=>{
 const role='stat_runtime_'+tag(),backup='stat_backup_'+tag(),client=await pool.connect();
 try{await client.query('BEGIN');await client.query(`CREATE ROLE ${role} NOLOGIN;CREATE ROLE ${backup} NOLOGIN;GRANT USAGE ON SCHEMA vinyl TO ${role},${backup};GRANT SELECT ON vinyl.users,vinyl.user_auth,vinyl.bug_report_deliveries,vinyl.runtime_control TO ${role};${authGrants(role,backup)}`);
 await client.query('SET LOCAL ROLE '+role);await client.query("INSERT INTO vinyl.statistics_daily(day) VALUES('2026-01-01')");await client.query('SELECT * FROM vinyl.statistics_state');await assert.rejects(client.query('CREATE TABLE vinyl.must_not_create(x int)'));await client.query('ROLLBACK');
 }finally{await client.query('ROLLBACK');client.release();}
});

test('confirmed failure then acceptance reuses saved snapshot and recipient; activation day stays partial only once',async()=>{
 clock=Date.parse('2026-10-15T07:00:00Z');const received=[];let state='failed';const job=reporter({sendStatistics:async m=>{received.push(m);return state;}});
 await job.run();await pool.query("UPDATE vinyl.statistics_daily SET registrations=registrations+10 WHERE day='2026-10-14'");
 clock+=5*60000;state='accepted';assert.equal((await job.run()).state,'sent');assert.deepEqual(received[1],received[0]);await job.run();assert.equal(received.length,2);
 clock=Date.parse('2026-10-16T07:00:00Z');await job.run();assert.equal(received[2].payload.partial,false);assert.equal(received[2].payload.day,'2026-10-15');
});
test('start time is durable across restart; no pre-start report or retroactive zero day',async()=>{
 const before=(await pool.query('SELECT started_at FROM vinyl.statistics_state')).rows[0].started_at.toISOString();
 clock+=30000;await createStatistics(pool,{now:()=>clock}).initialize();assert.equal((await pool.query('SELECT started_at FROM vinyl.statistics_state')).rows[0].started_at.toISOString(),before);
 let calls=0;await reporter({sendStatistics:async()=>{calls++;return 'accepted';}}).run();assert.equal(calls,0);assert.equal((await pool.query('SELECT * FROM vinyl.statistics_reports')).rowCount,0);
});

test('metric failure rolls back user operation and signup counts only at completed verification',async()=>{
 const messages=[],ip=tag(),store=await createAuthStore({pool,secret:randomBytes(32).toString('hex'),registrationEnabled:true,statistics:stats,emailService:{send:async m=>{messages.push(m);return 'accepted';}}});
 const login='stat_'+tag(),flow=await store.start('registration',{login,email:login+'@example.test'},ip);await store.flushMail();assert.equal(await counts('2026-10-14'),undefined);
 const verified=await store.verify(flow.token,messages.at(-1).code,ip);assert.equal(await counts('2026-10-14'),undefined);
 await store.complete(verified.token,{password,repeat:password},ip);assert.equal((await counts('2026-10-14')).registrations,'1');
 const user=(await pool.query('SELECT id FROM vinyl.users WHERE login=$1',[login])).rows[0];
 const failing=createPostgresServices(pool,user.id,null,null,{count:async()=>{throw Error('fixture accounting failure');}});
 await assert.rejects(failing.createRecord({...recordDraft,artist:'Rollback stats fixture'}));assert.equal((await failing.getCollection()).length,0);
 assert.equal((await counts('2026-10-14')).collection_added,'0');
});

test('capture mail end-to-end has aggregates only; old identity rows expire without changing counters',async()=>{
 const {mkdtemp,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const {createEmailService}=await import('../../server/security/email.mjs');const root=await mkdtemp(join(tmpdir(),'vinyl-stat-mail-'));
 try{
  const a=await account();await stats.view(a.session);
  await pool.query("INSERT INTO vinyl.statistics_user_days(user_id,day) VALUES($1,'2026-10-01')",[a.session.userId]);
  clock=Date.parse('2026-10-15T07:00:00Z');const mail=createEmailService({NODE_ENV:'development',EMAIL_ADAPTER:'capture',EMAIL_CAPTURE_FILE:join(root,'mail.jsonl')});
  const job=reporter(mail);assert.equal((await job.run()).state,'sent');await job.run();
  const messages=(await readFile(join(root,'mail.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(messages.length,1);assert.equal(messages[0].to,'obratsev@yandex.ru');assert.ok(!messages[0].text.includes(a.session.userId));
  assert.equal((await pool.query("SELECT * FROM vinyl.statistics_user_days WHERE day='2026-10-01'")).rowCount,0);
  assert.equal((await counts('2026-10-14')).active_users,'1');
 }finally{await rm(root,{recursive:true,force:true});}
});
