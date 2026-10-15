import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectRelease, releasePlan, smokeRelease, checkRelease } from '../server/release-safety.mjs';

const migrations = Array.from({ length: 6 }, (_, i) => ({ name: `${String(i+1).padStart(3,'0')}_fixture.sql`, checksum: createHash('sha256').update(String(i)).digest('hex') }));
const artifact = (min=5, max=5, count=5) => ({ release: 'a'.repeat(40), policy: { minimumSchema: min, maximumSchema: max }, migrations: migrations.slice(0,count) });
const state = overrides => ({ candidate: artifact(), rollback: artifact(), applied: migrations.slice(0,5), frozen: false, mirrors: [{generation:'2',synced_generation:'2',last_error:null}], ...overrides });

test('ordinary update allows exact schema and refuses edited, missing, future or incompatible history', () => {
  assert.equal(releasePlan(state()).compatible,true);
  for (const applied of [[], migrations.slice(0,4), migrations, [{...migrations[0],checksum:'f'.repeat(64)},...migrations.slice(1,5)]]) assert.throws(()=>releasePlan(state({applied})));
  assert.throws(()=>releasePlan(state({frozen:true})), /FREEZE/);
  assert.throws(()=>releasePlan(state({mirrors:[{generation:'3',synced_generation:'2'}]})), /MIRROR/);
});
test('pending migration requires explicitly verified rollback schema and after check refuses incomplete migration', () => {
  const candidate=artifact(6,6,6), rollback=artifact(5,6,6);
  const s=state({candidate,rollback});
  assert.equal(releasePlan(s).migrationReviewRequired,true);
  assert.throws(()=>releasePlan({...s,rollback:artifact()}),/ROLLBACK_SCHEMA/);
  assert.throws(()=>releasePlan(s,'after'),/NOT_APPLIED/);
  assert.equal(releasePlan({...s,applied:migrations},'after').compatible,true);
});
test('artifact inspection hashes packaged SQL without executing it; legacy declaration bound to exact RELEASE', async () => {
  const dir=await mkdtemp(join(tmpdir(),'vinyl-release-'));
  try {
    await mkdir(join(dir,'migrations'));
    for(const m of migrations.slice(0,5))await writeFile(join(dir,'migrations',m.name),'not executed');
    await writeFile(join(dir,'RELEASE'),'a'.repeat(40));
    const policy={format:1,authMode:'multiuser',minimumSchema:5,maximumSchema:5};
    const external=join(dir,'legacy.json');
    await writeFile(external,JSON.stringify({...policy,release:'b'.repeat(40)}));
    await assert.rejects(inspectRelease(dir,external),/POLICY/);
    await writeFile(external,JSON.stringify({...policy,release:'a'.repeat(40)}));
    assert.equal((await inspectRelease(dir,external)).migrations.length,5);
    await writeFile(external,JSON.stringify({...policy,release:'a'.repeat(40),maximumSchema:6,compatibleMigrations:[migrations[5]]}));
    assert.equal((await inspectRelease(dir,external)).migrations.length,6);
    await writeFile(external,JSON.stringify({...policy,release:'a'.repeat(40),maximumSchema:6,compatibleMigrations:[{...migrations[5],checksum:'wildcard'}]}));
    await assert.rejects(inspectRelease(dir,external),/ATTESTATION/);
    await writeFile(join(dir,'release-policy.json'),JSON.stringify({...policy,maximumSchema:6}));
    await assert.rejects(inspectRelease(dir),/UNVERIFIABLE/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('preflight uses read-only transaction and releases a broken connection after rollback failure',async()=>{
  const sql=[];let broken;
  const client={query:async q=>{sql.push(q);if(q.includes('schema_migrations'))return {rows:migrations.slice(0,5)};if(q.includes('runtime_control'))return {rows:[{frozen:false}]};if(q.includes('mirror_state'))return {rows:[]};return {rows:[]};},release:value=>broken=value};
  assert.equal((await checkRelease({connect:async()=>client},artifact(),artifact())).compatible,true);
  assert.match(sql[0],/READ ONLY/);assert.equal(sql.at(-1),'COMMIT');assert.equal(broken,false);
  await assert.rejects(checkRelease({connect:async()=>client},artifact(),artifact(),'before','expected-owner'),/MIRROR_CONFIGURATION/);
  client.query=async()=>{throw Error('fixture');};
  await assert.rejects(checkRelease({connect:async()=>client},artifact(),artifact()));assert.equal(broken,true);
});
function reply(path) {
  if(['/collection','/wishlist'].includes(path))return new Response(null,{status:302,headers:{Location:'/'}});
  if(['/api/collection','/api/wishlist'].includes(path))return Response.json({error:'AUTH_REQUIRED'},{status:401});
  if(path==='/api/auth/session')return Response.json({role:'guest',authMode:'multiuser'});
  if(path.startsWith('/api/u/'))return Response.json([]);
  return new Response('fixture',{headers:{'Content-Type':path.endsWith('.mjs')?'text/javascript':path.endsWith('.webp')?'image/webp':'text/html'}});
}
test('smoke uses bounded GET only, no cookies or redirect following, and cancels response streams',async()=>{
  const calls=[];
  const checks=await smokeRelease('http://127.0.0.1:8040',{publicLogin:'fixture',fetch:async(url,options)=>{calls.push(options);return reply(url.pathname);}});
  assert.equal(checks.length,11);
  for(const options of calls){assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');assert.ok(options.signal);assert.ok(!options.headers.Cookie);}
  for(const origin of ['http://example.com','https://user:pass@example.com','https://example.com/private'])await assert.rejects(smokeRelease(origin));
});
test('smoke fails closed for guest data, wrong redirect/content or unavailable application',async()=>{
  await assert.rejects(smokeRelease('https://example.com',{fetch:async()=>Response.json({})}));
  await assert.rejects(smokeRelease('https://example.com',{fetch:async url=>url.pathname==='/collection'?new Response(null,{status:302,headers:{Location:'/someone/collection'}}):reply(url.pathname)}),/REDIRECT/);
  await assert.rejects(smokeRelease('https://example.com',{fetch:async()=>{throw Error('network');}}));
});
