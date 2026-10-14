import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ledgerFixture } from './fixtures/deletion-ledger.mjs';
test('immutable ledger confirms minimal tombstone and idempotently resolves lost acknowledgement',async()=>{
 const f=ledgerFixture(),id=randomUUID();f.state.lostAck=true;
 const first=await f.ledger.append(id,'removed_user');
 assert.deepEqual(await f.ledger.append(id,'removed_user'),first);
 assert.equal(f.state.entries.length,1);assert.deepEqual(Object.keys(first).sort(),['deletedAt','login','previous','seq','userId']);
 assert.equal(f.ledger.productionReady,false);
});
test('ledger detects corruption, missing suffix, stale replay, missing Object Lock and unavailable storage',async()=>{
 for(const fault of ['tamper','missing','stale','unavailable','objectLock','noOverwrite','noDelete','complete','fresh']){
  const f=ledgerFixture();await f.ledger.append(randomUUID(),'removed_user');
  if(fault in f.state.protection)f.state.protection[fault]=false;else f.state[fault]=true;
  await assert.rejects(f.newLedger().read(),/DELETION_SAFETY_UNAVAILABLE/);
 }
});
test('ledger detects rollback even when adapter signs a fresh but older head',async()=>{
 const f=ledgerFixture();await f.ledger.append(randomUUID(),'removed_user');f.state.entries=[];
 await assert.rejects(f.ledger.read(),/DELETION_SAFETY_UNAVAILABLE/);
});
test('concurrent independent writers never acknowledge a lost deletion',async()=>{
 const f=ledgerFixture(),other=f.newLedger();
 const results=await Promise.allSettled([f.ledger.append(randomUUID(),'first_user'),other.append(randomUUID(),'second_user')]);
 assert.ok(results.some(r=>r.status==='fulfilled'));
 for(const r of results)if(r.status==='fulfilled')assert.ok(f.state.entries.some(e=>e.userId===r.value.userId));
});
test('missing storage and failed durability never acknowledge deletion; signature corruption closes reads',async()=>{
 const f=ledgerFixture();f.adapter.appendImmutable=async()=>{throw Error('write not durable');};
 await assert.rejects(f.ledger.append(randomUUID(),'never_deleted'),/DELETION_SAFETY_UNAVAILABLE/);
 assert.equal(f.state.entries.length,0);
 const read=f.adapter.readFresh;f.adapter.readFresh=async nonce=>{const e=await read(nonce);e.signature='invalid';return e;};
 await assert.rejects(f.ledger.read(),/DELETION_SAFETY_UNAVAILABLE/);
 f.adapter.readFresh=async()=>undefined;await assert.rejects(f.ledger.read(),/DELETION_SAFETY_UNAVAILABLE/);
});
test('ledger read deadline keeps unavailable storage closed',async()=>{
 const {createDeletionLedger}=await import('../server/security/deletion-ledger.mjs');
 const ledger=createDeletionLedger({adapter:{readFresh:()=>new Promise(()=>{})},publicKey:'unused',journalId:'fixture',timeoutMs:5});
 await assert.rejects(ledger.read(),/DELETION_SAFETY_UNAVAILABLE/);
});
