import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { createPool } from '../../server/postgres/config.mjs';
import { migrate } from '../../server/postgres/migrations.mjs';
import { requireTestDatabase } from './safety.mjs';
import { createAuthStore,digest } from '../../server/security/auth-store.mjs';
import { insertUser } from '../../server/postgres/users.mjs';
import { transaction } from '../../server/security/auth-store.mjs';
import { createMultiUserAuth } from '../../server/security/http-auth.mjs';
import { createApp } from '../../server/app.mjs';
import { scopedServices } from '../../server/security/scoped-services.mjs';
import { once } from 'node:events';
const pool=createPool(process.env.DATABASE_URL),secret=randomBytes(32).toString('hex');
const password='Local fixture password alpha',changed='Local fixture password beta';
before(async()=>{await requireTestDatabase(pool);await migrate(pool);await pool.query('TRUNCATE vinyl.restore_epoch CASCADE');});after(()=>pool.end());
const tag=()=>randomUUID().replaceAll('-','').slice(0,16);
async function context(options={}){
 let time=Date.now();const messages=[];
 const args={pool,secret,registrationEnabled:true,now:()=>time,emailService:{send:async message=>{messages.push(message);return options.sendState||'accepted';}},...options};
 const store=await createAuthStore(args);
 return {store,messages,args,tick:ms=>{time+=ms;},ip:tag()};
}
async function registration(c,login='user_'+tag(),email=tag()+'@example.test'){
 const flow=await c.store.start('registration',{login,email},c.ip);
 await c.store.flushMail();const code=c.messages.at(-1).code;
 const verified=await c.store.verify(flow.token,code,c.ip);
 return {flow,verified,login,email};
}
async function account(c){const r=await registration(c);await c.store.complete(r.verified.token,{password,repeat:password},c.ip);return r;}
test('signup creates user only at completion, stores digests, private defaults, login/logout persistence',async()=>{
 const c=await context(),r=await registration(c);
 assert.equal((await pool.query('SELECT id FROM vinyl.users WHERE login=$1',[r.login])).rowCount,0);
 await c.store.complete(r.verified.token,{password,repeat:password},c.ip);
 const user=(await pool.query('SELECT * FROM vinyl.users WHERE login=$1',[r.login])).rows[0];
 assert.equal(user.collection_public,false);assert.equal(user.wishlist_public,false);
 const {token,session}=await c.store.login({login:r.login,password},c.ip);
 assert.equal(session.userId,user.id);
 const row=(await pool.query('SELECT * FROM vinyl.auth_sessions WHERE token_digest=$1',[digest(token)])).rows[0];
 assert.ok(row);assert.ok(!JSON.stringify(row).includes(token));
 const restarted=await createAuthStore(c.args);assert.equal((await restarted.session(token)).userId,user.id);
 await restarted.logout(token);assert.equal(await c.store.session(token),null);
 await assert.rejects(c.store.complete(r.verified.token,{password,repeat:password},c.ip),/FLOW_EXPIRED/);
});
test('concurrent signup completion for same login commits one user and no orphan reservation',async()=>{
 const a=await context(),b=await context(),login='race_'+tag();
 const ar=await registration(a,login),br=await registration(b,login);
 const results=await Promise.allSettled([a.store.complete(ar.verified.token,{password,repeat:password},a.ip),b.store.complete(br.verified.token,{password,repeat:password},b.ip)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await pool.query('SELECT id FROM vinyl.users WHERE login=$1',[login])).rowCount,1);
});
test('OTP has bounded attempts and replay rejection; resend invalidates old code',async()=>{
 const c=await context(),email=tag()+'@example.test';
 const flow=await c.store.start('registration',{login:'user_'+tag(),email},c.ip);await c.store.flushMail();const first=c.messages.at(-1).code;
 c.tick(61000);await c.store.resend(flow.token,c.ip);await c.store.flushMail();
 const next=c.messages.at(-1).code;
 if(first!==next)await assert.rejects(c.store.verify(flow.token,first,c.ip),/INVALID_CODE/);
 const results=await Promise.allSettled([c.store.verify(flow.token,next,c.ip),c.store.verify(flow.token,next,c.ip)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const second=await c.store.start('registration',{login:'user_'+tag(),email:tag()+'@example.test'},c.ip);await c.store.flushMail();
 const real=c.messages.at(-1).code,wrong=real==='000000'?'000001':'000000';
 for(let i=0;i<5;i++)await assert.rejects(c.store.verify(second.token,wrong,c.ip),/INVALID_CODE/);
 await assert.rejects(c.store.verify(second.token,real,c.ip),/INVALID_CODE/);
});
test('reset revokes all sessions, rejects old password and other device grants',async()=>{
 const c=await context(),r=await account(c);
 const one=await c.store.login({login:r.login,password},c.ip),two=await c.store.login({login:r.login,password},c.ip);
 const reset=await c.store.start('reset',{email:r.email},c.ip);await c.store.flushMail();
 const verified=await c.store.verify(reset.token,c.messages.at(-1).code,c.ip);
 await c.store.complete(verified.token,{password:changed,repeat:changed},c.ip);
 assert.equal(await c.store.session(one.token),null);assert.equal(await c.store.session(two.token),null);
 await assert.rejects(c.store.login({login:r.login,password},c.ip),/INVALID_CREDENTIALS/);
 assert.ok((await c.store.login({login:r.login,password:changed},c.ip)).token);
 await assert.rejects(c.store.complete(verified.token,{password,repeat:password},c.ip),/FLOW_EXPIRED/);
});
test('limits survive store restart; unknown recovery never sends or verifies',async()=>{
 const c=await context();for(let i=0;i<2;i++)await c.store.rate('fixture',c.ip,2,60000);
 const restarted=await createAuthStore(c.args);await assert.rejects(restarted.rate('fixture',c.ip,2,60000),/RATE_LIMITED/);
 const flow=await c.store.start('reset',{email:tag()+'@example.test'},c.ip);await c.store.flushMail();assert.equal(c.messages.length,0);
 await assert.rejects(c.store.verify(flow.token,'123456',c.ip),/INVALID_CODE/);
});
test('owner bootstrap keeps UUID, data counters and permanent reservation; email verified explicitly',async()=>{
 const name='owner_'+tag();const owner=await transaction(pool,client=>insertUser(client,{login:name,email:tag()+'@example.test',collectionPublic:true,wishlistPublic:true}));
 const c=await context({ownerId:owner.id,legacyEnabled:true});
 const before=(await pool.query('SELECT business_writes FROM vinyl.runtime_control')).rows[0].business_writes;
 const flow=await c.store.start('owner',{},c.ip,{legacy:true,userId:owner.id});await c.store.flushMail();
 assert.equal((await pool.query('SELECT user_id FROM vinyl.user_auth WHERE user_id=$1',[owner.id])).rowCount,0);
 const grant=await c.store.verify(flow.token,c.messages[0].code,c.ip);await c.store.complete(grant.token,{password,repeat:password},c.ip);
 assert.equal((await c.store.login({login:name,password},c.ip)).session.userId,owner.id);
 assert.equal((await pool.query('SELECT business_writes FROM vinyl.runtime_control')).rows[0].business_writes,before);
 const user=(await pool.query('SELECT * FROM vinyl.users WHERE id=$1',[owner.id])).rows[0];assert.equal(user.collection_public,true);
});
test('unknown delivery remains resendable; expiry is authoritative without cleanup',async()=>{
 const c=await context({sendState:'unknown'});const r=await c.store.start('registration',{login:'user_'+tag(),email:tag()+'@example.test'},c.ip);await c.store.flushMail();
 assert.equal((await pool.query('SELECT send_state FROM vinyl.auth_challenges c JOIN vinyl.auth_flows f ON f.id=c.flow_id WHERE f.token_digest=$1',[digest(r.token)])).rows[0].send_state,'unknown');
 c.tick(600001);await assert.rejects(c.store.verify(r.token,c.messages[0].code,c.ip),/INVALID_CODE/);
 await c.store.resend(r.token,c.ip);await c.store.flushMail();assert.equal(c.messages.length,2);
 c.tick(1800000);await assert.rejects(c.store.verify(r.token,c.messages[1].code,c.ip),/FLOW_EXPIRED/);
});
test('HTTP preauth Origin/CSRF rejects before signup and guest cannot spoof ownership',async()=>{
 const owner=await transaction(pool,client=>insertUser(client,{login:'http_'+tag(),email:tag()+'@example.test',collectionPublic:true,wishlistPublic:true}));
 const server=createApp({},{}); // reserve a loopback port before configuring exact Origin
 server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;await new Promise(r=>server.close(r));
 const origin=`http://127.0.0.1:${port}`;
 const auth=await createMultiUserAuth({pool,ownerId:owner.id,env:{NODE_ENV:'development',APP_ORIGIN:origin,AUTH_SECRET:secret,AUTH_REGISTRATION_ENABLED:'true'},emailService:{send:async()=> 'accepted'}});
 const app=createApp({}, {auth,servicesForSession:scopedServices(pool,owner.id,null)});app.listen(port,'127.0.0.1');await once(app,'listening');
 try {
  const initial=await fetch(origin+'/api/auth/bootstrap'),data=await initial.json(),cookie=initial.headers.getSetCookie()[0].split(';')[0];
  assert.ok(cookie.includes('HttpOnly')===false);assert.ok(initial.headers.getSetCookie()[0].includes('HttpOnly'));
  const rejected=await fetch(origin+'/api/auth/registration',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:'{}'});assert.equal(rejected.status,403);
  const cross=await fetch(origin+'/api/auth/registration',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':data.csrfToken},body:'{}'});assert.equal(cross.status,403);
  const write=await fetch(origin+'/api/collection?userId='+owner.id,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({userId:owner.id})});assert.equal(write.status,401);
 } finally {app.closeAllConnections();await new Promise(r=>app.close(r));await auth.store.flushMail();}
});

test('session idle/absolute expiry and maximum ten devices are enforced',async()=>{
 const c=await context(),r=await account(c),tokens=[];
 for(let i=0;i<11;i++){tokens.push((await c.store.login({login:r.login,password},c.ip)).token);c.tick(1);}
 assert.equal(await c.store.session(tokens[0]),null);assert.ok(await c.store.session(tokens.at(-1)));
 c.tick(86400001);assert.equal(await c.store.session(tokens.at(-1)),null);
 const s=await c.store.login({login:r.login,password},c.ip);
 for(let day=0;day<7;day++){c.tick(23*3600000);await c.store.session(s.token);}
 c.tick(8*3600000);assert.equal(await c.store.session(s.token),null);
});
test('two verified device resets race: one completion wins, all previous capabilities fail',async()=>{
 const c=await context(),r=await account(c);
 const one=await c.store.start('reset',{email:r.email},c.ip);await c.store.flushMail();const a=await c.store.verify(one.token,c.messages.at(-1).code,c.ip);
 c.tick(61000);const two=await c.store.start('reset',{email:r.email},c.ip);await c.store.flushMail();const b=await c.store.verify(two.token,c.messages.at(-1).code,c.ip);
 const results=await Promise.allSettled([c.store.complete(a.token,{password:changed,repeat:changed},c.ip),c.store.complete(b.token,{password:changed,repeat:changed},c.ip)]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
});
test('scoped mutations reject a previously resolved session after password reset',async()=>{
 const c=await context(),r=await account(c),login=await c.store.login({login:r.login,password},c.ip),session=await c.store.session(login.token);
 const service=scopedServices(pool,session.userId,null)(session);
 const flow=await c.store.start('reset',{email:r.email},c.ip);await c.store.flushMail();const grant=await c.store.verify(flow.token,c.messages.at(-1).code,c.ip);
 await c.store.complete(grant.token,{password:changed,repeat:changed},c.ip);
 const {record}=await import('../fixtures/collection.mjs');const {id,coverId,favorite,...draft}=record;
 await assert.rejects(service.createRecord(draft),/AUTH_REQUIRED/);
});
test('same verified email races commit one user; login reservation from loser rolls back',async()=>{
 const c=await context(),email=tag()+'@example.test';
 const a=await registration(c,'one_'+tag(),email);c.tick(61000);const b=await registration(c,'two_'+tag(),email);
 const results=await Promise.allSettled([c.store.complete(a.verified.token,{password,repeat:password},c.ip),c.store.complete(b.verified.token,{password,repeat:password},c.ip)]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal((await pool.query('SELECT id FROM vinyl.users WHERE email_normalized=$1',[email])).rowCount,1);
 assert.equal((await pool.query('SELECT login_normalized FROM vinyl.login_reservations WHERE login_normalized=ANY($1)',[[a.login,b.login]])).rowCount,1);
});
test('auth audit contains event names and HMAC subjects, never passwords/email/OTP/token',async()=>{
 const events=[],c=await context({audit:e=>events.push(e)}),r=await account(c),login=await c.store.login({login:r.login,password},c.ip);
 await c.store.logout(login.token);const logs=JSON.stringify(events);
 for(const secret of [password,r.email,r.login,c.messages[0].code,login.token])assert.equal(logs.includes(secret),false);
 assert.ok(events.some(e=>e.event==='login_succeeded'));
});

test('A/B services isolate CRUD, Covers, Favorite, Transfer and CSV by authenticated UUID',async()=>{
 const {record}=await import('../fixtures/collection.mjs');const {wishDraft,purchase}=await import('../fixtures/wishlist.mjs');
 const {recordRevision}=await import('../../src/collection-record.mjs');const {wishlistRevision}=await import('../../src/wishlist-record.mjs');
 const {recordsCsv}=await import('../../prototype/record-presentation.mjs');
 const {createCoverStorage}=await import('../../server/cover-storage.mjs');const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {default:sharp}=await import('sharp');
 const c=await context(),a=await account(c),b=await account(c);
 const as=await c.store.session((await c.store.login({login:a.login,password},c.ip)).token),bs=await c.store.session((await c.store.login({login:b.login,password},c.ip)).token);
 const root=await mkdtemp(join(tmpdir(),'vinyl-auth-covers-')),covers=createCoverStorage(root),factory=scopedServices(pool,as.userId,covers),sa=factory(as),sb=factory(bs);
 try{
  const {id,coverId,favorite,...draft}=record;let r=await sa.createRecord({...draft,artist:'Private user A'});
  assert.deepEqual(await sb.getCollection(),[]);
  await assert.rejects(sb.changeFavorite(r.id,await recordRevision(r),{favorite:true}),/NOT_FOUND/);
  const png=await sharp({create:{width:50,height:50,channels:3,background:'#aaa'}}).png().toBuffer();
  r=await sa.changeCover('collection',r.id,await recordRevision(r),png);
  await sa.authorizeCover(r.coverId);await assert.rejects(sb.authorizeCover(r.coverId),/NOT_FOUND/);await assert.rejects(factory(null).authorizeCover(r.coverId),/NOT_FOUND/);
  await pool.query('UPDATE vinyl.users SET collection_public=true WHERE id=$1',[as.userId]);
  await scopedServices(pool,bs.userId,covers)(null).authorizeCover(r.coverId);
  await pool.query('UPDATE vinyl.users SET collection_public=false WHERE id=$1',[as.userId]);
  await assert.rejects(scopedServices(pool,bs.userId,covers)(null).authorizeCover(r.coverId),/NOT_FOUND/);
  r=await sa.changeFavorite(r.id,await recordRevision(r),{favorite:true});assert.equal(r.favorite,true);
  const w=await sa.createWishlistRecord({...wishDraft,artist:'Private wishlist A'});
  await assert.rejects(sb.transferRecord(w.id,await wishlistRevision(w),purchase),/NOT_FOUND/);
  assert.equal((await sa.transferRecord(w.id,await wishlistRevision(w),purchase)).status,'complete');
  assert.deepEqual(await sb.getWishlist(),[]);assert.ok(!recordsCsv(await sb.getCollection(),[['artist','Исполнитель'],['album','Альбом']]).includes('Private user A'));
  await assert.rejects(sb.deleteRecord(r.id,await recordRevision(r)),/NOT_FOUND/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('least privilege runtime can complete auth without CREATE; backup role reads new tables',async()=>{
 const {authGrants}=await import('../../server/security/grants.mjs');const role='auth_runtime_'+tag(),backup='auth_backup_'+tag();
 const client=await pool.connect();
 try{
  await client.query(`CREATE ROLE ${role} NOLOGIN;CREATE ROLE ${backup} NOLOGIN;GRANT USAGE ON SCHEMA vinyl TO ${role},${backup};GRANT SELECT ON vinyl.users,vinyl.login_reservations TO ${role};GRANT UPDATE(updated_at) ON vinyl.users TO ${role};${authGrants(role,backup)}`);
  await client.query(`SET ROLE ${role}`);
  assert.equal((await client.query("SELECT has_schema_privilege(current_user,'vinyl','CREATE') AS allowed")).rows[0].allowed,false);
  const login='limited_'+tag();await client.query('BEGIN');const u=await insertUser(client,{login,email:tag()+'@example.test'});
  const {passwordHash}=await import('../../server/security/passwords.mjs');const hash=await passwordHash(password);
  await client.query("INSERT INTO vinyl.user_auth(user_id,status,password_hash,email_verified_at) VALUES($1,'active',$2,now())",[u.id,hash]);await client.query('COMMIT');
  await client.query('RESET ROLE');await client.query(`SET ROLE ${backup}`);assert.ok((await client.query('SELECT user_id FROM vinyl.user_auth WHERE user_id=$1',[u.id])).rowCount);
  await assert.rejects(client.query('DELETE FROM vinyl.user_auth WHERE user_id=$1',[u.id]),/permission denied/);
 }finally{
  await client.query('ROLLBACK');await client.query('RESET ROLE');await client.query(`DROP OWNED BY ${role},${backup};DROP ROLE ${role};DROP ROLE ${backup}`);client.release();
 }
});

test('login verified against old hash cannot create a session after reset commits',async()=>{
 const c=await context(),r=await account(c),flow=await c.store.start('reset',{email:r.email},c.ip);await c.store.flushMail();
 const grant=await c.store.verify(flow.token,c.messages.at(-1).code,c.ip),user=(await pool.query('SELECT id FROM vinyl.users WHERE login=$1',[r.login])).rows[0];
 const blocker=await pool.connect();let reset,login;
 try{
  await blocker.query('BEGIN');await blocker.query('SELECT id FROM vinyl.users WHERE id=$1 FOR UPDATE',[user.id]);
  reset=c.store.complete(grant.token,{password:changed,repeat:changed},c.ip);
  const deadline=Date.now()+3000;let waiting=false;
  while(Date.now()<deadline){waiting=Number((await pool.query("SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT id FROM vinyl.users%'")).rows[0].n)>0;if(waiting)break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(waiting,true);
  // The reset is first in the row-lock queue; login reads the old committed hash.
  login=c.store.login({login:r.login,password},c.ip).then(value=>({value}),error=>({error}));
  await new Promise(r=>setTimeout(r,250));await blocker.query('COMMIT');await reset;
  assert.equal((await login).error?.message,'INVALID_CREDENTIALS');
 }finally{await blocker.query('ROLLBACK');blocker.release();await reset?.catch(()=>{});await login;}
});
test('concurrent resend leaves one code; failure adapter does not lose the flow',async()=>{
 const c=await context({sendState:'failed'}),flow=await c.store.start('registration',{login:'resend_'+tag(),email:tag()+'@example.test'},c.ip);await c.store.flushMail();c.tick(61000);
 await Promise.all([c.store.resend(flow.token,c.ip),c.store.resend(flow.token,c.ip)]);await c.store.flushMail();
 assert.equal(c.messages.length,2);
 const n=(await pool.query('SELECT count(*) AS n FROM vinyl.auth_challenges c JOIN vinyl.auth_flows f ON f.id=c.flow_id WHERE f.token_digest=$1 AND c.consumed_at IS NULL AND c.superseded_at IS NULL',[digest(flow.token)])).rows[0].n;
 assert.equal(n,'1');assert.equal((await c.store.verify(flow.token,c.messages.at(-1).code,c.ip)).state,'verified');
});
test('production registration requires complete capabilities and cookies retain host-only security flags',async()=>{
 const {ledgerFixture}=await import('../fixtures/deletion-ledger.mjs');
 const fixture=ledgerFixture();fixture.adapter.productionReady=true;const ledger=fixture.newLedger();
 const base={NODE_ENV:'production',DATA_BACKEND:'postgres',AUTH_MODE:'multiuser',PG_PRODUCTION_ACK:'stage4b',PG_OWNER_ID:randomUUID(),DATABASE_URL:'postgres://fixture:fixture@127.0.0.1:5432/vinyl_production',EMAIL_ADAPTER:'smtp',POSTBOX_KEY_ID:'fixture',POSTBOX_KEY_SECRET:'fixture',AUTH_LEGACY_ENABLED:'false',AUTH_REGISTRATION_ENABLED:'false',APP_ORIGIN:'https://vinyl-collection.ru',AUTH_SECRET:secret};
 await createMultiUserAuth({pool,env:{...base,AUTH_REGISTRATION_ENABLED:'true'},emailService:{check:async()=>true,send:async()=> 'accepted'}});
 const auth=await createMultiUserAuth({pool,env:{...base,AUTH_REGISTRATION_ENABLED:'true'},ledger,emailService:{check:async()=>true,send:async()=> 'accepted'}}),headers={};let result;
 const res={setHeader:(k,v)=>headers[k]=v,getHeader:k=>headers[k],writeHead(){},end:body=>result=JSON.parse(body)};
 await auth.handle({method:'GET',headers:{host:'vinyl-collection.ru'},socket:{remoteAddress:'127.0.0.1'}},res,'/api/auth/bootstrap',{},null);
 assert.equal(result.registrationEnabled,true);const cookie=headers['Set-Cookie'][0];assert.match(cookie,/^__Host-vinyl_pre=/);assert.match(cookie,/; Secure/);assert.match(cookie,/; HttpOnly/);assert.match(cookie,/; SameSite=Lax/);assert.ok(!cookie.includes('Domain='));
});

test('profile routes resolve the requested user, enforce independent privacy and reject URL-scoped writes',async t=>{
 const {record}=await import('../fixtures/collection.mjs');
 const c=await context(),a=await account(c),b=await account(c);
 const as=await c.store.session((await c.store.login({login:a.login,password},c.ip)).token);
 const bs=await c.store.session((await c.store.login({login:b.login,password},c.ip)).token);
 const factory=scopedServices(pool,as.userId,null);
 const {id,coverId,favorite,...draft}=record;
 await factory(as).createRecord({...draft,artist:'Profile A'});
 await factory(bs).createRecord({...draft,artist:'Profile B'});
 const app=createApp({}, {servicesForSession:factory,auth:{session:async req=>req.headers.cookie==='a'?as:req.headers.cookie==='b'?bs:null,limit(){},checkOrigin(){}}});
 app.listen(0,'127.0.0.1');await once(app,'listening');
 t.after(()=>new Promise(resolve=>{app.close(resolve);app.closeAllConnections();}));
 const base=`http://127.0.0.1:${app.address().port}`;
 const path=`/${a.login}/collection`,api=`/api/u/${a.login}/collection`;
 const closed=await fetch(base+path);assert.equal(closed.status,403);assert.match(await closed.text(),/Коллекция закрыта/);
 assert.equal((await fetch(base+api,{headers:{Cookie:'b'}})).status,403);
 assert.equal((await fetch(base+path,{headers:{Cookie:'a'}})).status,200);
 await pool.query('UPDATE vinyl.users SET collection_public=true WHERE id=$1',[as.userId]);
 for(const cookie of ['', 'b']){
   const res=await fetch(base+api,{headers:{Cookie:cookie}}),rows=await res.json();
   assert.equal(res.status,200);assert.equal(res.headers.get('X-Access-Role'),'guest');
   assert.equal(rows.length,1);assert.equal(rows[0].artist,'Profile A');assert.equal(rows[0].id,undefined);assert.equal(rows[0].purchasePrice,undefined);
 }
 const own=await fetch(base+api,{headers:{Cookie:'a'}});assert.equal(own.headers.get('X-Access-Role'),'owner');assert.ok((await own.json())[0].id);
 assert.equal((await fetch(base+`/u/${a.login}/wishlist`)).status,403);
 const alias=await fetch(base+`/u/${a.login}`,{redirect:'manual'});assert.equal(alias.headers.get('location'),path);
 const html=await(await fetch(base+path)).text();assert.ok(html.includes(`href="/${a.login}/wishlist"`));
 assert.equal((await fetch(base+api,{method:'POST',headers:{Cookie:'b'},body:'{}'})).status,405);
 assert.equal((await factory(bs).getCollection())[0].artist,'Profile B');
 const absent=await fetch(base+'/missing_'+tag());assert.equal(absent.status,404);assert.match(await absent.text(),/Пользователь не найден/);
 assert.equal((await fetch(base+'/auth')).status,200);
 assert.equal((await fetch(base+'/collection')).status,200);
});

import {createAccountStore} from '../../server/security/account-store.mjs';
import {recordRevision} from '../../src/collection-record.mjs';
import {wishlistRevision} from '../../src/wishlist-record.mjs';
import {record as fixtureRecord} from '../fixtures/collection.mjs';
import {wishDraft,purchase} from '../fixtures/wishlist.mjs';
const {id:fixtureId,coverId:fixtureCover,favorite:fixtureFavorite,...collectionDraft}=fixtureRecord;
async function accountSession(c,r){return c.store.session((await c.store.login({login:r.login,password},c.ip)).token);}

test('account settings and sale price: owner visibility, immediate public API/media policy, safe return and CSRF',async t=>{
 const c=await context(),a=await account(c),b=await account(c),as=await accountSession(c,a),bs=await accountSession(c,b);
 const covers={prepare:async()=>randomUUID(),read:async()=>Buffer.from('fixture')};
 const factory=scopedServices(pool,bs.userId,covers),sa=factory(as);
 let r=await sa.createRecord({...collectionDraft,salePrice:1250.25,purchasePrice:9999});
 r=await sa.changeCover('collection',r.id,await recordRevision(r),Buffer.from('fixture'));
 await sa.createWishlistRecord({...wishDraft,artist:'Sale wishlist fixture',salePrice:0});
 const app=createApp({},{});app.listen(0,'127.0.0.1');await once(app,'listening');const port=app.address().port;await new Promise(resolve=>app.close(resolve));
 const origin=`http://127.0.0.1:${port}`;
 const auth=await createMultiUserAuth({pool,ownerId:bs.userId,covers,env:{NODE_ENV:'development',APP_ORIGIN:origin,AUTH_SECRET:secret,AUTH_REGISTRATION_ENABLED:'true'},emailService:{send:async()=> 'accepted'}});
 const server=createApp({}, {auth,servicesForSession:factory});server.listen(port,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const login=await auth.store.login({login:a.login,password},tag());const cookie='vinyl_auth='+login.token;
 const post=(action,body,csrf=login.session.csrf)=>fetch(origin+'/api/auth/'+action,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});
 const bootstrap=async(returnTo,headers={})=>(await(await fetch(origin+'/api/auth/bootstrap?returnTo='+encodeURIComponent(returnTo),{headers})).json()).returnTo;
 assert.equal(await bootstrap(`/${a.login}/wishlist`),'/');
 assert.equal(await bootstrap(`/${b.login}/wishlist`,{Cookie:cookie}),`/${a.login}/collection`);
 assert.equal((await post('settings',{publicCollection:true,showSalePrice:true},'wrong')).status,403);
 assert.equal((await post('settings',{publicCollection:true,showSalePrice:true,userId:bs.userId})).status,400);
 assert.equal((await post('settings',{publicCollection:true,showSalePrice:false})).status,200);
 for(const section of ['collection','wishlist']){
  const res=await fetch(`${origin}/api/u/${a.login}/${section}`),rows=await res.json();assert.equal(res.status,200);assert.match(res.headers.get('cache-control'),/no-store/);assert.equal(rows[0].salePrice,undefined);assert.equal(rows[0].purchasePrice,undefined);
 }
 assert.equal(await bootstrap(`/${a.login}/wishlist`),`/${a.login}/wishlist`);
 for(const path of ['https://evil.test/x','//evil.test','/auth','/missing_account/collection',`/${a.login}/wishlist?next=https://evil.test`,`/%2f%2fevil/collection`])assert.equal(await bootstrap(path),'/');
 const ownerRows=await(await fetch(`${origin}/api/u/${a.login}/collection`,{headers:{Cookie:cookie}})).json();assert.equal(ownerRows[0].salePrice,1250.25);assert.equal(ownerRows[0].purchasePrice,9999);
 await post('settings',{publicCollection:true,showSalePrice:true});
 for(const section of ['collection','wishlist']){
  const rows=await(await fetch(`${origin}/api/u/${a.login}/${section}`)).json();assert.equal(rows[0].salePrice,section==='collection'?1250.25:0);assert.equal(rows[0].purchasePrice,undefined);assert.equal(rows[0].id,undefined);
 }
 await factory(null).authorizeCover(r.coverId);await factory(bs).authorizeCover(r.coverId);
 await post('settings',{publicCollection:false,showSalePrice:true});
 for(const section of ['collection','wishlist'])assert.equal((await fetch(`${origin}/api/u/${a.login}/${section}`)).status,403);
 await assert.rejects(factory(null).authorizeCover(r.coverId),/NOT_FOUND/);await assert.rejects(factory(bs).authorizeCover(r.coverId),/NOT_FOUND/);await sa.authorizeCover(r.coverId);
 const settings=await(await fetch(origin+'/api/auth/account',{headers:{Cookie:cookie}})).json();assert.equal(settings.publicCollection,false);assert.equal(settings.showSalePrice,true);assert.equal(settings.canDelete,true);
 assert.equal((await post('change-password',{currentPassword:password,password:changed,repeat:changed},'wrong')).status,403);
 assert.equal((await post('delete-account',{password,confirm:true},'wrong')).status,403);
 const changedResponse=await post('change-password',{currentPassword:password,password:changed,repeat:changed});assert.equal(changedResponse.status,200);assert.ok(changedResponse.headers.getSetCookie().some(value=>value.startsWith('vinyl_auth=')&&value.includes('HttpOnly')));
 assert.equal(await auth.store.session(login.token),null);
});

test('sale price is optional, validated, revisioned, cleared explicitly and carried through Transfer',async()=>{
 const c=await context(),r=await account(c),session=await accountSession(c,r),s=scopedServices(pool,session.userId,null)(session);
 const a=await s.createRecord(collectionDraft),rev=await recordRevision(a);
 const b=await s.updateRecord(a.id,rev,{...collectionDraft,salePrice:0});assert.equal(b.salePrice,0);assert.notEqual(await recordRevision(b),rev);
 await assert.rejects(s.updateRecord(a.id,rev,{...collectionDraft,salePrice:10}),/RECORD_CHANGED/);
 for(const salePrice of [-1,'100',Infinity])await assert.rejects(s.updateRecord(b.id,await recordRevision(b),{...collectionDraft,salePrice}),/INVALID_RECORD/);
 const cleared=await s.updateRecord(b.id,await recordRevision(b),{...collectionDraft,salePrice:null});assert.equal(Object.hasOwn(cleared,'salePrice'),false);assert.equal(await recordRevision(cleared),rev);
 const wish=await s.createWishlistRecord({...wishDraft,artist:'Sale transfer fixture',salePrice:567.89});await s.transferRecord(wish.id,await wishlistRevision(wish),purchase);
 assert.equal((await s.getCollection()).find(x=>x.artist==='Sale transfer fixture').salePrice,567.89);
});

test('account password change verifies current password, checks policy, rotates current session and revokes others',async()=>{
 const c=await context(),r=await account(c),one=await accountSession(c,r),two=await c.store.login({login:r.login,password},c.ip);
 const a=createAccountStore({pool,store:c.store,now:c.args.now});
 await assert.rejects(a.changePassword(one,{currentPassword:'incorrect',password:changed,repeat:changed},c.ip),/INVALID_CURRENT_PASSWORD/);
 await assert.rejects(a.changePassword(one,{currentPassword:password,password:'short',repeat:'short'},c.ip),/INVALID_PASSWORD/);
 await assert.rejects(a.changePassword(one,{currentPassword:password,password:changed,repeat:password},c.ip),/PASSWORD_MISMATCH/);
 const result=await a.changePassword(one,{currentPassword:password,password:changed,repeat:changed},c.ip);
 assert.equal(await c.store.session(two.token),null);assert.ok(await c.store.session(result.token));
 await assert.rejects(a.settings(one,{publicCollection:true,showSalePrice:false}),/AUTH_REQUIRED/);
 await assert.rejects(c.store.login({login:r.login,password},c.ip),/INVALID_CREDENTIALS/);
 assert.ok((await c.store.login({login:r.login,password:changed},c.ip)).token);
 await assert.rejects(a.changePassword(one,{currentPassword:password,password:changed,repeat:changed},c.ip));
 await assert.rejects(a.changePassword(one,{currentPassword:password,password:changed,repeat:changed},c.ip),/RATE_LIMITED/);
});

test('hard delete commits scoped data removal, preserves mirror/login reservation and retries filesystem cleanup safely',async()=>{
 const {mkdtemp,rm,access}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {default:sharp}=await import('sharp');const {createCoverStorage}=await import('../../server/cover-storage.mjs');
 const root=await mkdtemp(join(tmpdir(),'vinyl-delete-fixtures-')),covers=createCoverStorage(root);
 const c=await context(),a=await account(c),b=await account(c),as=await accountSession(c,a),bs=await accountSession(c,b);
 const factory=scopedServices(pool,bs.userId,covers),sa=factory(as),sb=factory(bs);
 const png=await sharp({create:{width:10,height:10,channels:3,background:'#aaa'}}).png().toBuffer();
 let ra=await sa.createRecord(collectionDraft),rb=await sb.createRecord(collectionDraft);
 ra=await sa.changeCover('collection',ra.id,await recordRevision(ra),png);rb=await sb.changeCover('collection',rb.id,await recordRevision(rb),png);
 await sa.createWishlistRecord({...wishDraft,artist:'Delete wishlist fixture'});
 await pool.query('INSERT INTO vinyl.mirror_state(user_id) VALUES($1)',[bs.userId]);
 const mirrorBefore=(await pool.query('SELECT * FROM vinyl.mirror_state ORDER BY user_id')).rows;
 const broken=createAccountStore({pool,store:c.store,ownerId:bs.userId,covers:{removeDeleted:async()=>{throw Error('fixture disk unavailable');}},now:c.args.now});
 try{
  await assert.rejects(broken.remove(as,{password,confirm:false},c.ip),/CONFIRMATION_REQUIRED/);
  await assert.rejects(broken.remove(as,{password:'incorrect',confirm:true},c.ip),/INVALID_CURRENT_PASSWORD/);
  assert.equal((await sa.getCollection()).length,1);await access(join(root,ra.coverId));
  await assert.rejects(broken.remove(bs,{password,confirm:true},c.ip),/ACCOUNT_PROTECTED/);
  const result=await broken.remove(as,{password,confirm:true},c.ip);assert.equal(result.cleanupPending,true);
  for(const table of ['users','collection_records','wishlist_records','covers','user_auth','auth_sessions'])assert.equal((await pool.query(`SELECT 1 FROM vinyl.${table} WHERE ${table==='users'?'id':'user_id'}=$1`,[as.userId])).rowCount,0);
  assert.equal((await pool.query('SELECT 1 FROM vinyl.auth_flows WHERE email_normalized=$1',[a.email])).rowCount,0);
  assert.equal((await pool.query('SELECT 1 FROM vinyl.login_reservations WHERE login_normalized=$1',[a.login])).rowCount,1);
  assert.equal((await pool.query('SELECT 1 FROM vinyl.cover_cleanup WHERE id=$1',[ra.coverId])).rowCount,1);await access(join(root,ra.coverId));
  await assert.rejects(pool.query('INSERT INTO vinyl.covers(id,user_id,storage_key) VALUES($1,$2,$3)',[ra.coverId,bs.userId,ra.coverId]),/cleanup pending/);
  await assert.rejects(factory.profile(a.login,'collection',null),/NOT_FOUND/);
  assert.deepEqual((await pool.query('SELECT * FROM vinyl.mirror_state ORDER BY user_id')).rows,mirrorBefore);
  assert.deepEqual(await sb.getCollection(),[rb]);await access(join(root,rb.coverId));
  const resumed=createAccountStore({pool,store:c.store,covers,now:c.args.now});await resumed.cleanup();await resumed.cleanup();
  await assert.rejects(access(join(root,ra.coverId)));await access(join(root,rb.coverId));
  assert.equal((await pool.query('SELECT 1 FROM vinyl.cover_cleanup WHERE id=$1',[ra.coverId])).rowCount,0);
  await assert.rejects(covers.removeDeleted('../escape'),/INVALID_COVER/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('least-privilege account runtime can update settings and delete its fixture without DDL',async()=>{
 const {authGrants}=await import('../../server/security/grants.mjs');
 const c=await context(),r=await account(c),session=await accountSession(c,r),role='account_runtime_'+tag(),backup='account_backup_'+tag();
 const client=await pool.connect();
 try{
  await client.query(`CREATE ROLE ${role} NOLOGIN;CREATE ROLE ${backup} NOLOGIN;GRANT USAGE ON SCHEMA vinyl TO ${role},${backup};GRANT SELECT ON ALL TABLES IN SCHEMA vinyl TO ${role};GRANT UPDATE(business_writes) ON vinyl.runtime_control TO ${role};GRANT UPDATE(generation,next_attempt_at,dirty_since) ON vinyl.mirror_state TO ${role};GRANT DELETE ON vinyl.collection_records,vinyl.wishlist_records TO ${role};${authGrants(role,backup)}`);
  await client.query(`SET ROLE ${role}`);
  const limited={query:(...args)=>client.query(...args),connect:async()=>({query:(...args)=>client.query(...args),release(){}})};
  const store=await createAuthStore({...c.args,pool:limited});const a=createAccountStore({pool:limited,store,now:c.args.now});
  assert.equal((await a.get(session)).canDelete,true);await a.settings(session,{publicCollection:true,showSalePrice:true});
  assert.equal((await a.get(session)).showSalePrice,true);assert.equal((await a.remove(session,{password,confirm:true},c.ip)).state,'deleted');
  assert.equal((await client.query("SELECT has_schema_privilege(current_user,'vinyl','CREATE') AS allowed")).rows[0].allowed,false);
 }finally{await client.query('ROLLBACK');await client.query('RESET ROLE');await client.query(`DROP OWNED BY ${role},${backup};DROP ROLE ${role};DROP ROLE ${backup}`);client.release();}
});
test('sale price stays in PG while owner mirror retains its established Sheets format',async()=>{
 const {enableMirror,reconcile}=await import('../../server/postgres/mirror.mjs');
 const c=await context(),r=await account(c),session=await accountSession(c,r),s=scopedServices(pool,session.userId,null)(session);
 await enableMirror(pool,session.userId);await s.createRecord({...collectionDraft,salePrice:1234});
 const snapshot={collection:[],wishlist:[]};const adapter={read:async section=>snapshot[section],replace:async(section,rows)=>{snapshot[section]=rows;}};
 assert.equal((await reconcile(pool,session.userId,adapter)).status,'verified');
 assert.equal(snapshot.collection[0].salePrice,undefined);assert.equal((await s.getCollection())[0].salePrice,1234);
});

test('owner password change cannot claim session revocation while legacy bridge is active',async()=>{
 const c=await context(),r=await account(c),session=await accountSession(c,r);
 const a=createAccountStore({pool,store:c.store,ownerId:session.userId,legacyEnabled:true,now:c.args.now});
 assert.equal((await a.get(session)).canChangePassword,false);
 await assert.rejects(a.changePassword(session,{currentPassword:password,password:changed,repeat:changed},c.ip),/OWNER_BRIDGE_ACTIVE/);
 assert.ok((await c.store.login({login:r.login,password},c.ip)).token);
});

import {ledgerFixture} from '../fixtures/deletion-ledger.mjs';
import {createDeletionSafety} from '../../server/security/deletion-safety.mjs';
test('external deletion survives old DB state, reconciles Covers/reservations and preserves other users',async()=>{
 const c=await context(),a=await account(c),b=await account(c),as=await accountSession(c,a),bs=await accountSession(c,b);
 const covers={prepare:async()=>randomUUID(),read:async()=>Buffer.from('fixture'),removeDeleted:async()=>{}};
 const factory=scopedServices(pool,bs.userId,covers),sa=factory(as),sb=factory(bs);
 let record=await sa.createRecord(collectionDraft);record=await sa.changeCover('collection',record.id,await recordRevision(record),Buffer.from('fixture'));
 const other=await sb.createRecord(collectionDraft);await sa.createWishlistRecord({...wishDraft,artist:'Ledger wishlist fixture'});
 await pool.query('UPDATE vinyl.users SET collection_public=true,wishlist_public=true WHERE id=$1',[as.userId]);
 const tables=['users','user_auth','auth_sessions','covers','collection_records','wishlist_records'];
 const old={};for(const table of tables)old[table]=(await pool.query(`SELECT * FROM vinyl.${table} WHERE ${table==='users'?'id':'user_id'}=$1`,[as.userId])).rows;
 const f=ledgerFixture(),accounts=createAccountStore({pool,store:c.store,covers,ownerId:bs.userId,ledger:f.ledger});
 f.state.unavailable=true;await assert.rejects(accounts.remove(as,{password,confirm:true},c.ip),/DELETION_SAFETY_UNAVAILABLE/);
 assert.equal((await pool.query('SELECT 1 FROM vinyl.users WHERE id=$1',[as.userId])).rowCount,1);
 f.state.unavailable=false;f.state.lostAck=true;
 assert.equal((await accounts.remove(as,{password,confirm:true},c.ip)).state,'deleted');assert.equal(f.state.entries.length,1);
 // Re-create the exact pre-delete rows as an old dump would, in the marked test DB only.
 await transaction(pool,async client=>{
  await client.query('DELETE FROM vinyl.cover_cleanup WHERE user_id=$1',[as.userId]);
  await client.query('DELETE FROM vinyl.login_reservations WHERE login_normalized=$1',[a.login]);
  await client.query('INSERT INTO vinyl.login_reservations(login_normalized) VALUES($1)',[a.login]);
  for(const table of tables)for(const row of old[table])await client.query(`INSERT INTO vinyl.${table} SELECT * FROM json_populate_record(NULL::vinyl.${table},$1::json)`,[JSON.stringify(row)]);
 });
 const safety=createDeletionSafety({pool,ledger:f.newLedger(),ownerId:bs.userId});
 await safety.ready();await safety.ready();
 assert.equal((await pool.query('SELECT 1 FROM vinyl.users WHERE id=$1',[as.userId])).rowCount,0);
 assert.equal((await pool.query('SELECT 1 FROM vinyl.login_reservations WHERE login_normalized=$1',[a.login])).rowCount,1);
 assert.equal((await pool.query('SELECT 1 FROM vinyl.cover_cleanup WHERE id=$1',[record.coverId])).rowCount,1);
 assert.equal((await pool.query('SELECT 1 FROM vinyl.auth_sessions WHERE user_id=$1',[as.userId])).rowCount,0);
 await assert.rejects(c.store.login({login:a.login,password},c.ip),/INVALID_CREDENTIALS/);
 await assert.rejects(factory.profile(a.login,'collection',null),/NOT_FOUND/);
 await assert.rejects(factory.profile(a.login,'wishlist',null),/NOT_FOUND/);
 await assert.rejects(factory(null).authorizeCover(record.coverId),/NOT_FOUND/);
 assert.deepEqual(await sb.getCollection(),[other]);
});
test('DB failure after external append cannot leave account accessible at next request gate',async()=>{
 const c=await context(),a=await account(c),as=await accountSession(c,a),f=ledgerFixture();
 const accounts=createAccountStore({pool,store:c.store,ledger:f.ledger});
 // Inject a failure after durable append, before the DB deletion commits.
 const original=f.ledger.append;f.ledger.append=async(...args)=>{await original(...args);throw Error('fixture SQL phase failure');};
 await assert.rejects(accounts.remove(as,{password,confirm:true},c.ip),/fixture SQL/);
 assert.equal(f.state.entries.length,1);assert.equal((await pool.query('SELECT 1 FROM vinyl.users WHERE id=$1',[as.userId])).rowCount,1);
 await createDeletionSafety({pool,ledger:f.newLedger()}).ready();
 assert.equal((await pool.query('SELECT 1 FROM vinyl.users WHERE id=$1',[as.userId])).rowCount,0);
});
test('restore is fail-closed for missing/corrupt/stale ledger and quarantines old passwords/privacy/sessions',async()=>{
 const c=await context(),a=await account(c),login=await c.store.login({login:a.login,password},c.ip),f=ledgerFixture();
 const safety=createDeletionSafety({pool,ledger:f.ledger});
 await pool.query('UPDATE vinyl.users SET collection_public=true,wishlist_public=true WHERE id=$1',[login.session.userId]);
 f.state.unavailable=true;await assert.rejects(safety.restore(),/DELETION_SAFETY_UNAVAILABLE/);
 assert.ok(await c.store.session(login.token));
 f.state.unavailable=false;f.state.stale=true;await assert.rejects(safety.restore(),/DELETION_SAFETY_UNAVAILABLE/);
 f.state.stale=false;
 assert.equal((await safety.restore()).state,'quarantined');
 assert.equal(await c.store.session(login.token),null);
 await assert.rejects(c.store.login({login:a.login,password},c.ip),/INVALID_CREDENTIALS/);
 const row=(await pool.query('SELECT collection_public,wishlist_public FROM vinyl.users WHERE id=$1',[login.session.userId])).rows[0];
 assert.deepEqual(row,{collection_public:false,wishlist_public:false});
 assert.equal((await pool.query('SELECT count(*) FROM vinyl.auth_sessions')).rows[0].count,'0');
 assert.equal((await pool.query('SELECT count(*) FROM vinyl.auth_flows')).rows[0].count,'0');
 assert.equal((await createDeletionSafety({pool}).restore()).state,'quarantined');
});
test('SMTP preflight failure has identical contract for existing and unknown recovery addresses',async()=>{
 const c=await context(),a=await account(c);let checked=0;
 c.args.emailService.check=async()=>{checked++;return false;};
 for(const email of [a.email,tag()+'@example.test'])await assert.rejects(c.store.start('reset',{email},c.ip),error=>error.status===503&&error.message==='MAIL_UNAVAILABLE');
 assert.equal(checked,2);
});

test('auth restore works without ledger while mirror cannot skip quarantine',async()=>{
 const {requireWorkerSafety,quarantineRestoredAuth}=await import('../../server/security/deletion-safety.mjs');
 assert.equal((await quarantineRestoredAuth(pool)).state,'quarantined');
 await assert.rejects(requireWorkerSafety(pool),/RESTORE_QUARANTINE/);
 const f=ledgerFixture(),safety=createDeletionSafety({pool,ledger:f.ledger});
 await assert.rejects(requireWorkerSafety(pool,safety),/RESTORE_QUARANTINE/);
 f.state.unavailable=true;await assert.rejects(requireWorkerSafety(pool,safety),/DELETION_SAFETY_UNAVAILABLE/);
});

test('restore reconciles a frozen backup without thawing it and reserves post-backup deleted logins',async()=>{
 const {freeze}=await import('../../server/postgres/boundary.mjs');
 const f=ledgerFixture(),login='gone_'+tag();await f.ledger.append(randomUUID(),login);
 await freeze(pool,true);
 try{
  const safety=createDeletionSafety({pool,ledger:f.ledger});
  await assert.rejects(safety.ready(),/DELETION_SAFETY_UNAVAILABLE/);
  assert.equal((await safety.restore()).state,'quarantined');
  assert.equal((await pool.query('SELECT frozen FROM vinyl.runtime_control')).rows[0].frozen,true);
  assert.equal((await pool.query('SELECT 1 FROM vinyl.login_reservations WHERE login_normalized=$1',[login])).rowCount,1);
 }finally{await freeze(pool,false);}
});

test('restore recovery binds UUID/epoch, consumes grant once and keeps old capabilities revoked/private',async()=>{
 const c=await context(),a=await account(c),old=await c.store.login({login:a.login,password},c.ip),f=ledgerFixture();
 const safety=createDeletionSafety({pool});
 const stale=await c.store.start('reset',{email:a.email},c.ip);await c.store.flushMail();const staleCode=c.messages.at(-1).code;
 await safety.restore();
 await assert.rejects(c.store.verify(stale.token,staleCode,c.ip),/FLOW_EXPIRED/);
 const flow=await c.store.start('reset',{email:a.email},c.ip);await c.store.flushMail();
 const grant=(await pool.query('SELECT g.*,f.kind FROM vinyl.restore_recovery_grants g JOIN vinyl.auth_flows f ON f.id=g.flow_id WHERE f.token_digest=$1',[digest(flow.token)])).rows[0];
 assert.equal(grant.user_id,old.session.userId);assert.equal(grant.kind,'restore');
 const code=c.messages.at(-1).code;
 await assert.rejects(c.store.verify(flow.token,code==='000000'?'000001':'000000',c.ip),/INVALID_CODE/);
 const verified=await c.store.verify(flow.token,code,c.ip);
 await assert.rejects(c.store.complete(verified.token,{password,repeat:password},c.ip),/INVALID_PASSWORD/);
 const results=await Promise.allSettled([1,2].map(()=>c.store.complete(verified.token,{password:changed,repeat:changed},c.ip)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 await assert.rejects(c.store.complete(verified.token,{password:changed,repeat:changed},c.ip),/FLOW_EXPIRED/);
 assert.equal(await c.store.session(old.token),null);
 await assert.rejects(c.store.login({login:a.login,password},c.ip),/INVALID_CREDENTIALS/);
 assert.ok(await c.store.login({login:a.login,password:changed},c.ip));
 assert.deepEqual((await pool.query('SELECT collection_public,wishlist_public FROM vinyl.users WHERE id=$1',[old.session.userId])).rows[0],{collection_public:false,wishlist_public:false});
});

test('restore recovery rejects ordinary disabled/deleted accounts and SMTP failure without enumeration',async()=>{
 const c=await context(),a=await account(c),b=await account(c),f=ledgerFixture();
 const id=(await c.store.login({login:a.login,password},c.ip)).session.userId;
 const deletedId=(await c.store.login({login:b.login,password},c.ip)).session.userId;
 await pool.query("UPDATE vinyl.user_auth SET status='disabled' WHERE user_id=$1",[id]);
 await f.ledger.append(deletedId,b.login);
 await createDeletionSafety({pool,ledger:f.ledger}).restore();
 assert.equal((await pool.query('SELECT 1 FROM vinyl.restore_quarantine WHERE user_id=ANY($1::uuid[])',[[id,deletedId]])).rowCount,0);
 const before=c.messages.length;
 for(const email of [a.email,b.email,tag()+'@example.test']){
  const flow=await c.store.start('reset',{email},c.ip);await c.store.flushMail();
  assert.equal(flow.state,'pending');await assert.rejects(c.store.verify(flow.token,'123456',c.ip),/INVALID_CODE/);
 }
 assert.equal(c.messages.length,before);
 c.args.emailService.check=async()=>false;
 for(const email of [a.email,b.email])await assert.rejects(c.store.start('reset',{email},c.ip),/MAIL_UNAVAILABLE/);
});

test('restore recovery expires OTP/grant and a repeated restore invalidates the previous epoch',async()=>{
 const c=await context(),a=await account(c),f=ledgerFixture(),safety=createDeletionSafety({pool});
 await safety.restore();
 let flow=await c.store.start('reset',{email:a.email},c.ip);await c.store.flushMail();
 const code=c.messages.at(-1).code;c.tick(11*60000);
 await assert.rejects(c.store.verify(flow.token,code,c.ip),/INVALID_CODE/);
 flow=await c.store.start('reset',{email:a.email},c.ip);await c.store.flushMail();
 let verified=await c.store.verify(flow.token,c.messages.at(-1).code,c.ip);c.tick(16*60000);
 await assert.rejects(c.store.complete(verified.token,{password:changed,repeat:changed},c.ip),/FLOW_EXPIRED/);
 flow=await c.store.start('reset',{email:a.email},c.ip);await c.store.flushMail();
 verified=await c.store.verify(flow.token,c.messages.at(-1).code,c.ip);
 const epoch=(await pool.query('SELECT restore_id FROM vinyl.restore_epoch')).rows[0].restore_id;
 await safety.restore();
 assert.notEqual((await pool.query('SELECT restore_id FROM vinyl.restore_epoch')).rows[0].restore_id,epoch);
 await assert.rejects(c.store.complete(verified.token,{password:changed,repeat:changed},c.ip),/FLOW_EXPIRED/);
 c.tick(3600000);
 flow=await c.store.start('reset',{email:a.email},c.ip);await c.store.flushMail();
 verified=await c.store.verify(flow.token,c.messages.at(-1).code,c.ip);
 await c.store.complete(verified.token,{password:changed,repeat:changed},c.ip);
});

test('restore recovery SMTP failure, concurrent verification and restricted runtime preserve isolation',async()=>{
 const {authGrants}=await import('../../server/security/grants.mjs');
 const c=await context(),a=await account(c),b=await account(c),f=ledgerFixture();
 const id=(await c.store.login({login:a.login,password},c.ip)).session.userId;
 const other=(await c.store.login({login:b.login,password},c.ip)).session.userId;
 await createDeletionSafety({pool,ledger:f.ledger}).restore();
 c.args.emailService.check=async()=>false;
 await assert.rejects(c.store.start('reset',{email:a.email},c.ip),/MAIL_UNAVAILABLE/);
 assert.equal((await pool.query('SELECT 1 FROM vinyl.restore_recovery_grants WHERE user_id=$1',[id])).rowCount,0);
 c.args.emailService.check=async()=>true;
 const deliver=c.args.emailService.send;c.args.emailService.send=async()=>{throw Error('synthetic SMTP outage');};
 const failed=await c.store.start('reset',{email:a.email},c.ip);await c.store.flushMail();
 assert.equal((await pool.query('SELECT c.send_state FROM vinyl.auth_challenges c JOIN vinyl.auth_flows f ON f.id=c.flow_id WHERE f.token_digest=$1',[digest(failed.token)])).rows[0].send_state,'unknown');
 assert.equal((await pool.query('SELECT status FROM vinyl.user_auth WHERE user_id=$1',[id])).rows[0].status,'disabled');
 c.args.emailService.send=deliver;c.tick(61000);
 await c.store.resend(failed.token,c.ip);await c.store.flushMail();
 const results=await Promise.allSettled([1,2].map(()=>c.store.verify(failed.token,c.messages.at(-1).code,c.ip)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const verified=results.find(r=>r.status==='fulfilled').value;
 const role='recovery_runtime_'+tag(),backup='recovery_backup_'+tag(),client=await pool.connect();
 try{
  await client.query(`CREATE ROLE ${role} NOLOGIN;CREATE ROLE ${backup} NOLOGIN;GRANT USAGE ON SCHEMA vinyl TO ${role},${backup};GRANT SELECT ON vinyl.users TO ${role};${authGrants(role,backup)}`);
  await client.query(`SET ROLE ${role}`);
  const limited={query:(...args)=>client.query(...args),connect:async()=>({query:(...args)=>client.query(...args),release(){}})};
  const store=await createAuthStore({...c.args,pool:limited});
  await store.complete(verified.token,{password:changed,repeat:changed},c.ip);
  await assert.rejects(client.query('DELETE FROM vinyl.restore_quarantine'),/permission denied/);
  await assert.rejects(client.query('DELETE FROM vinyl.restore_epoch'),/permission denied/);
 }finally{await client.query('ROLLBACK');await client.query('RESET ROLE');await client.query(`DROP OWNED BY ${role},${backup};DROP ROLE ${role};DROP ROLE ${backup}`);client.release();}
 assert.equal((await pool.query('SELECT status FROM vinyl.user_auth WHERE user_id=$1',[other])).rows[0].status,'disabled');
 await assert.rejects(c.store.login({login:b.login,password},c.ip),/INVALID_CREDENTIALS/);
});

test('deletion without S3 is atomic on SQL failure and concurrent/repeated requests cannot reuse the session',async()=>{
 const c=await context(),a=await account(c),b=await account(c),as=await accountSession(c,a),bs=await accountSession(c,b);
 const services=scopedServices(pool,as.userId,null);
 await services(as).createRecord(collectionDraft);await services(bs).createRecord({...collectionDraft,artist:'Unaffected owner'});
 const original=await services(as).getCollection(),other=await services(bs).getCollection();
 const failing={query:(...args)=>pool.query(...args),connect:async()=>{
  const client=await pool.connect();return {release:()=>client.release(),query:(sql,args)=>{
   if(sql==='DELETE FROM vinyl.users WHERE id=$1')throw Error('synthetic final SQL failure');
   return client.query(sql,args);
  }};
 }};
 await assert.rejects(createAccountStore({pool:failing,store:c.store}).remove(as,{password,confirm:true},c.ip),/synthetic final SQL failure/);
 assert.deepEqual(await services(as).getCollection(),original);
 assert.ok(await c.store.session((await c.store.login({login:a.login,password},c.ip)).token));
 const accounts=createAccountStore({pool,store:c.store});
 const results=await Promise.allSettled([1,2].map(()=>accounts.remove(as,{password,confirm:true},c.ip)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 await assert.rejects(accounts.remove(as,{password,confirm:true},c.ip));
 assert.equal((await pool.query('SELECT 1 FROM vinyl.auth_sessions WHERE user_id=$1',[as.userId])).rowCount,0);
 await assert.rejects(c.store.login({login:a.login,password},c.ip),/INVALID_CREDENTIALS/);
 await assert.rejects(services.profile(a.login,'collection',null),/NOT_FOUND/);
 await assert.rejects(services.profile(a.login,'wishlist',null),/NOT_FOUND/);
 assert.deepEqual(await services(bs).getCollection(),other);
});

test('restore without ledger keeps mirror blocked until OTP recovery and never republishes data',async()=>{
 const {quarantineRestoredAuth}=await import('../../server/security/deletion-safety.mjs');
 const {enableMirror,reconcile}=await import('../../server/postgres/mirror.mjs');
 const c=await context(),a=await account(c),as=await accountSession(c,a);
 await enableMirror(pool,as.userId);await scopedServices(pool,as.userId,null)(as).createRecord(collectionDraft);
 const snapshot={collection:[],wishlist:[]};let calls=0;
 const adapter={read:async section=>{calls++;return snapshot[section];},replace:async(section,rows)=>{calls++;snapshot[section]=rows;}};
 await quarantineRestoredAuth(pool);
 assert.equal((await reconcile(pool,as.userId,adapter,{force:true})).status,'quarantined');assert.equal(calls,0);
 await assert.rejects(scopedServices(pool,as.userId,null).profile(a.login,'collection',null),/COLLECTION_PRIVATE/);
 const flow=await c.store.start('reset',{email:a.email},c.ip);await c.store.flushMail();
 const verified=await c.store.verify(flow.token,c.messages.at(-1).code,c.ip);
 await c.store.complete(verified.token,{password:changed,repeat:changed},c.ip);
 assert.equal((await reconcile(pool,as.userId,adapter,{force:true})).status,'verified');
 assert.deepEqual((await pool.query('SELECT collection_public,wishlist_public FROM vinyl.users WHERE id=$1',[as.userId])).rows[0],{collection_public:false,wishlist_public:false});
});
