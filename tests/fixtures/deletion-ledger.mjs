import { generateKeyPairSync, sign } from 'node:crypto';
import { ledgerEnvelope, ledgerHash, createDeletionLedger } from '../../server/security/deletion-ledger.mjs';
// The signing authority and mutable fixture controls NEVER enter application code.
export function ledgerFixture() {
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  const journalId='fixture-independent-journal';
  const state={entries:[], unavailable:false, tamper:false, missing:false, stale:false, lostAck:false, protection:{versioning:true,objectLock:true,immutableVersions:true,noDelete:true,noOverwrite:true,complete:true,fresh:true}};
  const adapter={
    productionReady:false,
    async readFresh(nonce) {
      if(state.unavailable)throw Error('fixture storage unavailable');
      const entries=structuredClone(state.entries),root=entries.length?ledgerHash(entries.at(-1)):ledgerHash([journalId]);
      const proof={journalId,nonce:state.stale?'old-nonce':nonce,expiresAt:Date.now()+10000,count:entries.length,root,protection:state.protection};
      const signature=sign(null,ledgerEnvelope(proof),privateKey).toString('base64');
      if(state.tamper && entries.length)entries[0].login='tampered';
      if(state.missing)entries.pop();
      return {proof,signature,entries};
    },
    async appendImmutable(entry,expectedRoot) {
      if(state.unavailable)throw Error('fixture storage unavailable');
      const root=state.entries.length?ledgerHash(state.entries.at(-1)):ledgerHash([journalId]);
      if(root!==expectedRoot)throw Error('CAS conflict');
      state.entries.push(structuredClone(entry));
      if(state.lostAck)throw Error('ack lost after durable append');
    }
  };
  return {state,adapter,newLedger:()=>createDeletionLedger({adapter,publicKey,journalId}),ledger:createDeletionLedger({adapter,publicKey,journalId})};
}
