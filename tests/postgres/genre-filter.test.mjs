import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {createPool} from '../../server/postgres/config.mjs';
import {migrate} from '../../server/postgres/migrations.mjs';
import {requireTestDatabase} from './safety.mjs';
import {createMultiUserAuth} from '../../server/security/http-auth.mjs';
import {scopedServices} from '../../server/security/scoped-services.mjs';
import {createApp} from '../../server/app.mjs';
import {genresInRecords} from '../../src/genres.mjs';
import {record} from '../fixtures/collection.mjs';
import {wish} from '../fixtures/wishlist.mjs';

test('PG authorized genre inputs isolate A/B and sections; public visitor sees only allowed profile records',async()=>{
 const pool=createPool(process.env.DATABASE_URL);let server,auth;
 try{
  await requireTestDatabase(pool);await migrate(pool);
  const messages=[];auth=await createMultiUserAuth({pool,env:{NODE_ENV:'development',APP_ORIGIN:'http://127.0.0.1:8040',AUTH_SECRET:randomBytes(32).toString('hex'),AUTH_REGISTRATION_ENABLED:'true'},emailService:{send:async m=>{messages.push(m);return 'accepted';}}});
  async function account(){
   const login='genres_'+randomUUID().replaceAll('-','').slice(0,12),ip=randomUUID(),password='Local genre fixture passphrase!';
   const flow=await auth.store.start('registration',{login,email:login+'@example.test'},ip);await auth.store.flushMail();
   const grant=await auth.store.verify(flow.token,messages.at(-1).code,ip);await auth.store.complete(grant.token,{password,repeat:password},ip);
   const signed=await auth.store.login({login,password},ip);return {login,token:signed.token,session:await auth.store.session(signed.token)};
  }
  const a=await account(),b=await account(),factory=scopedServices(pool,a.session.userId,null);
  const {id,coverId,favorite,...base}=record;
  for(let i=0;i<2;i++)await factory(a.session).createRecord({...base,artist:'Public A '+i,genre:'Rock',additionalGenre:i?'Blues':'Jazz'});
  await factory(b.session).createRecord({...base,artist:'Private B',genre:'Ambient',additionalGenre:null});
  const {id:wid,coverId:wcover,...wbase}=wish;
  await factory(a.session).createWishlistRecord({...wbase,genre:'Soul',additionalGenre:null});
  await pool.query('UPDATE vinyl.users SET collection_public=true,wishlist_public=false WHERE id=$1',[a.session.userId]);
  server=createApp({}, {auth,servicesForSession:factory});server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port;
  const get=(path,user)=>fetch(origin+path,{headers:user?{Cookie:'vinyl_auth='+user.token}:{}});
  assert.deepEqual(genresInRecords(await (await get('/api/collection',a)).json()),['Rock','Blues','Jazz']);
  assert.deepEqual(genresInRecords(await (await get('/api/wishlist',a)).json()),['Soul']);
  assert.deepEqual(genresInRecords(await (await get('/api/collection',b)).json()),['Ambient']);
  for(const visitor of [null,b]){
   const response=await get('/api/u/'+a.login+'/collection',visitor);assert.equal(response.status,200);
   const data=await response.json();assert.ok(data.every(r=>!Object.hasOwn(r,'id')&&!Object.hasOwn(r,'purchasePrice')));
   assert.deepEqual(genresInRecords(data),['Rock','Blues','Jazz']);
   assert.equal((await get('/api/u/'+a.login+'/wishlist',visitor)).status,403);
  }
  assert.equal((await get('/api/u/'+b.login+'/collection')).status,403);
  assert.equal((await get('/api/collection')).status,401);
  await pool.query('UPDATE vinyl.users SET collection_public=false WHERE id=$1',[a.session.userId]);
  assert.equal((await get('/api/u/'+a.login+'/collection')).status,403);
  assert.deepEqual(genresInRecords(await (await get('/api/collection',a)).json()),['Rock','Blues','Jazz']);
 }finally{if(server)await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await auth?.store.flushMail();await pool.end();}
});
