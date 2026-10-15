import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {createPool} from '../../server/postgres/config.mjs';
import {migrate} from '../../server/postgres/migrations.mjs';
import {requireTestDatabase} from './safety.mjs';
import {createMultiUserAuth} from '../../server/security/http-auth.mjs';
import {createDurableReportService} from '../../server/report-delivery.mjs';
import {createApp} from '../../server/app.mjs';
const pool=createPool(process.env.DATABASE_URL);
before(async()=>{await requireTestDatabase(pool);await migrate(pool);await pool.query('TRUNCATE vinyl.restore_epoch CASCADE');});
beforeEach(()=>pool.query('TRUNCATE vinyl.bug_report_deliveries'));
after(()=>pool.end());
const input={text:'Описание проблемы\n=HYPERLINK("fixture")',section:'collection',page:'/collection'};
const repo=()=>{const records=[];return {records,getRecords:async()=>structuredClone(records),appendRecord:async r=>records.push(structuredClone(r))};};
async function context(origin='http://127.0.0.1:8040'){
 const messages=[],secret=randomBytes(32).toString('hex');
 const auth=await createMultiUserAuth({pool,env:{NODE_ENV:'development',APP_ORIGIN:origin,AUTH_SECRET:secret,AUTH_REGISTRATION_ENABLED:'true'},emailService:{send:async m=>{messages.push(m);return 'accepted';}}});
 const login='report_'+randomUUID().replaceAll('-','').slice(0,12),ip=randomUUID(),password='Local report fixture passphrase!';
 const flow=await auth.store.start('registration',{login,email:login+'@example.test'},ip);await auth.store.flushMail();
 const verified=await auth.store.verify(flow.token,messages.at(-1).code,ip);await auth.store.complete(verified.token,{password,repeat:password},ip);
 const signed=await auth.store.login({login,password},ip),session=await auth.store.session(signed.token);
 return {auth,session,token:signed.token};
}
const service=(repository,sendReport=async()=> 'accepted',recipient='owner@example.test')=>createDurableReportService(pool,{repository,mail:{sendReport},recipient});
const row=async id=>(await pool.query('SELECT * FROM vinyl.bug_report_deliveries WHERE id=$1',[id])).rows[0];
const due=()=>pool.query("UPDATE vinyl.bug_report_deliveries SET next_attempt_at=clock_timestamp()-interval '1 second'");

test('durable acceptance deduplicates concurrent retries, isolates users and rejects changed payload',async()=>{
 const a=await context(),b=await context(),repository=repo(),s=service(repository),requestId=randomUUID();
 const values=await Promise.all(Array.from({length:8},()=>s.create(input,{session:a.session,requestId})));
 assert.equal(new Set(values.map(r=>r.id)).size,1);assert.deepEqual(Object.keys(values[0]),['id']);
 assert.equal((await pool.query('SELECT count(*) FROM vinyl.bug_report_deliveries')).rows[0].count,'1');
 await assert.rejects(s.create({...input,text:'changed'},{session:a.session,requestId}),{status:409,message:'REPORT_REQUEST_CONFLICT'});
 const other=await s.create(input,{session:b.session,requestId});assert.notEqual(other.id,values[0].id);
 for(const extra of ['userId','email','from','to'])await assert.rejects(s.create({...input,[extra]:'spoof'},{session:a.session,requestId:randomUUID()}),{status:400});
 assert.equal(repository.records.length,0);
});
test('SMTP and Sheets outage never lose accepted reports; known SMTP failure retries after store restart',async()=>{
 const a=await context(),repository=repo();repository.getRecords=async()=>{throw Error('private provider error');};
 let calls=0;const s=service(repository,async()=>{calls++;return 'failed';});
 const requestId=randomUUID(),result=await s.create(input,{session:a.session,requestId});
 assert.equal(calls,0);await s.pump();assert.equal(calls,1);assert.equal((await row(result.id)).mail_state,'pending');
 assert.deepEqual(await s.create(input,{session:a.session,requestId}),result);
 await due();const restarted=service(repo(),async()=>{calls++;return 'accepted';});await restarted.pump();
 assert.equal((await row(result.id)).mail_state,'sent');assert.equal((await row(result.id)).text,input.text);assert.equal(calls,2);
});
test('ambiguous SMTP timeout and interrupted sending are not resent automatically',async()=>{
 const a=await context();let calls=0;const s=service(repo(),async()=>{calls++;throw Error('secret SMTP timeout');});
 const r=await s.create(input,{session:a.session,requestId:randomUUID()});await s.pump();assert.equal((await row(r.id)).mail_state,'unknown');
 await due();await s.pump();assert.equal(calls,1);
 const next=await s.create(input,{session:a.session,requestId:randomUUID()});await pool.query("UPDATE vinyl.bug_report_deliveries SET mail_state='sending' WHERE id=$1",[next.id]);
 await due();await s.pump();assert.equal((await row(next.id)).mail_state,'unknown');assert.equal(calls,1);
});
test('worker serializes concurrent pumps; accepted Sheet write with lost response is reconciled by ID',async()=>{
 const a=await context(),repository=repo();let appends=0,calls=0,release;
 repository.appendRecord=async r=>{appends++;repository.records.push(r);throw Error('lost response');};
 const s=service(repository,()=>{calls++;return new Promise(resolve=>release=resolve);});
 const r=await s.create(input,{session:a.session,requestId:randomUUID()});const running=s.pump();
 while(!release)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal(await service(repository).pump(),false);release('accepted');await running;
 await due();await s.pump();assert.equal(appends,1);assert.equal(calls,1);assert.equal((await row(r.id)).sheet_state,'sent');
});
test('ambiguous Sheet append never blindly appends again and report stays in PostgreSQL',async()=>{
 const a=await context(),repository=repo();let appends=0;
 repository.appendRecord=async()=>{appends++;throw Error('ambiguous network');};
 const s=service(repository),r=await s.create(input,{session:a.session,requestId:randomUUID()});await s.pump();
 assert.equal((await row(r.id)).sheet_state,'unknown');await due();await s.pump();assert.equal(appends,1);
 assert.equal((await row(r.id)).mail_state,'sent');assert.equal((await row(r.id)).text,input.text);
});
test('persistent user rate limit survives service restart, while replay does not create another row',async()=>{
 const a=await context(),s=service(repo()),requestId=randomUUID();await s.create(input,{session:a.session,requestId});
 for(let i=0;i<2;i++)await s.create(input,{session:a.session,requestId:randomUUID()});
 const fresh=service(repo());await assert.rejects(fresh.create(input,{session:a.session,requestId:randomUUID()}),{status:429});
 assert.ok((await fresh.create(input,{session:a.session,requestId})).id);
});
test('reports reject anonymous, missing CSRF, foreign origin, forged identity and revoked sessions',async t=>{
 const reservation=createApp({},{});reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const a=await context(`http://127.0.0.1:${port}`),repository=repo(),s=service(repository);
 const server=createApp({createReport:s.create},{auth:a.auth});server.listen(port,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
 const base=`http://127.0.0.1:${server.address().port}`;
 const headers={Origin:base,'Content-Type':'application/json','Idempotency-Key':randomUUID()};
 const post=(extra={},body=input)=>fetch(base+'/api/bug-reports',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});
 assert.equal((await post()).status,401);
 const cookie='vinyl_auth='+a.token;
 assert.equal((await post({Cookie:cookie})).status,403);
 const authenticated={Cookie:cookie,'X-CSRF-Token':a.session.csrf};
 assert.equal((await post({...authenticated,Origin:'https://evil.example'})).status,403);
 assert.equal((await post(authenticated,{...input,userId:randomUUID()})).status,400);
 const accepted=await post(authenticated);assert.equal(accepted.status,201);const id=(await accepted.json()).id;
 assert.equal((await row(id)).user_id,a.session.userId);assert.equal(repository.records.length,0);
 await a.auth.store.logout(a.token);assert.equal((await post(authenticated)).status,401);
});
test('freeze blocks new acceptance and delivery; worker never sends while frozen',async()=>{
 const a=await context();let calls=0;const s=service(repo(),async()=>{calls++;return 'accepted';});
 await s.create(input,{session:a.session,requestId:randomUUID()});
 await pool.query('UPDATE vinyl.runtime_control SET frozen=true WHERE singleton');
 try {assert.equal(await s.pump(),false);await assert.rejects(s.create(input,{session:a.session,requestId:randomUUID()}),{status:503});assert.equal(calls,0);}
 finally{await pool.query('UPDATE vinyl.runtime_control SET frozen=false WHERE singleton');}
});

test('known SMTP rejection has at most five attempts and keeps report after retry exhaustion',async()=>{
 const a=await context();let calls=0;const s=service(repo(),async()=>{calls++;return 'failed';});
 const r=await s.create(input,{session:a.session,requestId:randomUUID()});
 for(let i=0;i<7;i++){await due();await s.pump();}
 assert.equal(calls,5);assert.equal((await row(r.id)).mail_state,'failed');assert.equal((await row(r.id)).text,input.text);
 await assert.rejects(s.create({...input,text:'bad\0text'},{session:a.session,requestId:randomUUID()}),{status:400});
});

test('runtime grants support durable report and delivery; backup role reads report without UPDATE',async()=>{
 const a=await context(),tag=randomUUID().replaceAll('-','').slice(0,12),role='report_runtime_'+tag,backup='report_backup_'+tag;
 const {authGrants}=await import('../../server/security/grants.mjs');const client=await pool.connect();
 try{
  await client.query(`CREATE ROLE ${role} NOLOGIN;CREATE ROLE ${backup} NOLOGIN;GRANT USAGE ON SCHEMA vinyl TO ${role},${backup};GRANT SELECT ON vinyl.runtime_control TO ${role};${authGrants(role,backup)}`);
  await client.query(`SET ROLE ${role}`);
  const wrapped={connect:async()=>({query:(...args)=>client.query(...args),release(){}})};
  const s=createDurableReportService(wrapped,{repository:repo(),mail:{sendReport:async()=> 'accepted'},recipient:'owner@example.test'});
  const r=await s.create(input,{session:a.session,requestId:randomUUID()});await s.pump();
  await client.query('RESET ROLE');await client.query(`SET ROLE ${backup}`);
  assert.equal((await client.query('SELECT id FROM vinyl.bug_report_deliveries WHERE id=$1',[r.id])).rowCount,1);
  await assert.rejects(client.query("UPDATE vinyl.bug_report_deliveries SET mail_state='pending' WHERE id=$1",[r.id]),/permission denied/);
 }finally{
  await client.query('RESET ROLE');await client.query(`DROP OWNED BY ${role},${backup};DROP ROLE ${role};DROP ROLE ${backup}`);client.release();
 }
});
