import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rename, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPool } from '../../server/postgres/config.mjs';
import { requireTestDatabase } from './safety.mjs';
import { migrate } from '../../server/postgres/migrations.mjs';
import { createMultiUserAuth } from '../../server/security/http-auth.mjs';
import { createApp } from '../../server/app.mjs';
import { scopedServices } from '../../server/security/scoped-services.mjs';
import { checkRelease, smokeRelease } from '../../server/release-safety.mjs';
import { record } from '../fixtures/collection.mjs';

test('existing migration lock timeout bounds concurrent release contention without schema changes',async()=>{
  const pool=createPool(process.env.DATABASE_URL);
  let holder;
  try {
    await requireTestDatabase(pool);await migrate(pool);
    const before=(await pool.query('SELECT name,checksum FROM vinyl.schema_migrations ORDER BY name')).rows;
    holder=await pool.connect();await holder.query('SELECT pg_advisory_lock(44160401)');
    const started=Date.now();
    await assert.rejects(migrate(pool),error=>['55P03','57014'].includes(error.code));
    assert.ok(Date.now()-started<8000,'migration lock wait must be bounded');
    assert.deepEqual((await pool.query('SELECT name,checksum FROM vinyl.schema_migrations ORDER BY name')).rows,before);
  }finally{if(holder){await holder.query('SELECT pg_advisory_unlock(44160401)');holder.release();}await pool.end();}
});

test('local upgrade and failed-smoke rollback preserve PG session, user data, mirror and Covers',async()=>{
  const pool=createPool(process.env.DATABASE_URL);
  let app,auth,dir;
  const stop=async()=>{if(app){await new Promise(resolve=>{app.close(resolve);app.closeIdleConnections();});app=null;}await auth?.store.flushMail();};
  try {
    await requireTestDatabase(pool);await migrate(pool);
    dir=await mkdtemp(join(tmpdir(),'vinyl-release-rehearsal-'));
    for(const release of ['previous','candidate','bad'])await mkdir(join(dir,release));
    await symlink('previous',join(dir,'current'));
    const switchTo=async name=>{await symlink(name,join(dir,'next'));await rename(join(dir,'next'),join(dir,'current'));};
    const messages=[], secret=randomBytes(32).toString('hex'),login='rel_'+randomUUID().replaceAll('-','').slice(0,12);
    const env={NODE_ENV:'development',APP_ORIGIN:'http://127.0.0.1:8040',AUTH_SECRET:secret,AUTH_REGISTRATION_ENABLED:'true'};
    const makeAuth=()=>createMultiUserAuth({pool,env,emailService:{send:async m=>{messages.push(m);return 'accepted';}}});
    auth=await makeAuth();
    const ip=randomUUID(), password='Release fixture passphrase October!';
    const flow=await auth.store.start('registration',{login,email:login+'@example.test'},ip);await auth.store.flushMail();
    const grant=await auth.store.verify(flow.token,messages.at(-1).code,ip);await auth.store.complete(grant.token,{password,repeat:password},ip);
    const signed=await auth.store.login({login,password},ip), userId=signed.session.userId;
    const {id,coverId,favorite,...draft}=record;
    await scopedServices(pool,userId,null)(await auth.store.session(signed.token)).createRecord(draft);
    const snapshot=async()=>JSON.stringify({user:(await pool.query(`SELECT u.id,u.login,u.collection_public,u.wishlist_public,a.password_hash,a.auth_version FROM vinyl.users u JOIN vinyl.user_auth a ON a.user_id=u.id WHERE u.id=$1`,[userId])).rows,records:(await pool.query('SELECT * FROM vinyl.collection_records WHERE user_id=$1 ORDER BY id',[userId])).rows});
    const before=await snapshot();
    const mirrorBefore=JSON.stringify((await pool.query('SELECT * FROM vinyl.mirror_state ORDER BY user_id')).rows);
    await writeFile(join(dir,'fixture-cover.webp'),'synthetic cover');
    const coverHash=()=>readFile(join(dir,'fixture-cover.webp')).then(b=>createHash('sha256').update(b).digest('hex'));
    const beforeCover=await coverHash();
    const start=async()=>{auth=await makeAuth();app=createApp({}, {auth,servicesForSession:scopedServices(pool,userId,null)});app.listen(0,'127.0.0.1');await once(app,'listening');return `http://127.0.0.1:${app.address().port}`;};
    const verifySession=async origin=>{const response=await fetch(origin+'/api/auth/session',{headers:{Cookie:'vinyl_auth='+signed.token}});assert.equal((await response.json()).userId,userId);};
    let origin=await start();await verifySession(origin);await smokeRelease(origin);
    await stop();await switchTo('candidate');origin=await start();await smokeRelease(origin);await verifySession(origin);
    await stop();await switchTo('bad');
    // Broken candidate/startup: smoke fails before traffic is reopened.
    await assert.rejects(smokeRelease('http://127.0.0.1:1'));
    const applied=(await pool.query('SELECT name,checksum FROM vinyl.schema_migrations ORDER BY name')).rows;
    const artifact={release:'a'.repeat(40),policy:{minimumSchema:applied.length,maximumSchema:applied.length},migrations:applied};
    // Existing unrelated fixture mirrors can be dirty: gate must stop rather than alter them.
    const mirrors=(await pool.query('SELECT generation,synced_generation,last_error FROM vinyl.mirror_state')).rows;
    const frozen=(await pool.query('SELECT frozen FROM vinyl.runtime_control WHERE singleton')).rows[0].frozen;
    if(!frozen&&mirrors.every(m=>!m.last_error&&String(m.generation)===String(m.synced_generation)))assert.equal((await checkRelease(pool,artifact,artifact,'after')).compatible,true);
    else await assert.rejects(checkRelease(pool,artifact,artifact,'after'));
    await switchTo('previous');origin=await start();await smokeRelease(origin);await verifySession(origin);
    assert.equal(await readlink(join(dir,'current')),'previous');
    assert.equal(await snapshot(),before);assert.equal(await coverHash(),beforeCover);
    assert.equal(JSON.stringify((await pool.query('SELECT * FROM vinyl.mirror_state ORDER BY user_id')).rows),mirrorBefore);
  } finally {await stop();await pool.end();if(dir)await rm(dir,{recursive:true,force:true});}
});
