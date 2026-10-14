import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from '../server/app.mjs';
import {OperationError} from '../server/record-operations.mjs';
test('unverified ledger blocks public pages, auth, API, CSV source and Covers before any data handler',async()=>{
 let accessed=0;
 const app=createApp({getCollection:()=>{accessed++;return[];}},{auth:{ready:async()=>{throw new OperationError(503,'DELETION_SAFETY_UNAVAILABLE');},session:()=>{accessed++;return null;}}});
 app.listen(0,'127.0.0.1');await once(app,'listening');
 try{
  const origin=`http://127.0.0.1:${app.address().port}`;
  for(const path of ['/','/alice/collection','/alice/wishlist','/api/auth/session','/api/collection','/api/u/alice/collection','/media/covers/11111111-1111-4111-8111-111111111111/image.webp','/auth']){
   const response=await fetch(origin+path);assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'DELETION_SAFETY_UNAVAILABLE'});
  }
  assert.equal(accessed,0);
 }finally{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));}
});
