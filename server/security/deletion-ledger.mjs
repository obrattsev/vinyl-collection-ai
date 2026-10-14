import { createHash, randomBytes, verify } from 'node:crypto';
import { OperationError } from '../record-operations.mjs';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const ledgerHash = hash;
export const ledgerEnvelope = value => Buffer.from(JSON.stringify(value));
const denied = () => { throw new OperationError(503, 'DELETION_SAFETY_UNAVAILABLE'); };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const keys = (value, names) => value && Object.keys(value).sort().join() === names.sort().join();
// Provider boundary, NOT an S3 implementation. A provider must prove a fresh,
// complete, immutable head independently of the restored database. Mock evidence
// must never be accepted as production capability evidence.
export function createDeletionLedger({ adapter, publicKey, journalId, now = Date.now, timeoutMs = 3000 }) {
  if (!adapter || !publicKey || !journalId) throw Error('Independent deletion ledger required');
  let highest = 0, root = hash([journalId]), tail = Promise.resolve();
  async function bounded(work) {
    let timer;
    try { return await Promise.race([Promise.resolve().then(work), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('ledger deadline')), timeoutMs);
    })]); } finally { clearTimeout(timer); }
  }
  async function read() {
    try {
      const nonce = randomBytes(32).toString('hex');
      const envelope = await bounded(() => adapter.readFresh(nonce));
      const { proof, signature, entries } = envelope;
      if (!verify(null, ledgerEnvelope(proof), publicKey, Buffer.from(signature, 'base64'))) denied();
      if (proof.nonce !== nonce || proof.journalId !== journalId || !Number.isSafeInteger(proof.expiresAt) || proof.expiresAt < now() || proof.expiresAt > now() + 30000) denied();
      // Versioning alone, client declarations, and a hash without a fresh head
      // are insufficient. These claims must be backed by provider acceptance.
      const p = proof.protection;
      if (!p || ['versioning','objectLock','immutableVersions','noDelete','noOverwrite','complete','fresh'].some(name => p[name] !== true)) denied();
      if (!Array.isArray(entries) || entries.length !== proof.count || proof.count < highest) denied();
      let previous = hash([journalId]);
      const seen = new Set(), logins = new Set();
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (!keys(e, ['seq','previous','userId','login','deletedAt']) || e.seq !== i + 1 || e.previous !== previous || !uuid.test(e.userId) || !/^[a-z][a-z0-9_-]{2,29}$/.test(e.login) || !Number.isFinite(Date.parse(e.deletedAt)) || seen.has(e.userId) || logins.has(e.login)) denied();
        seen.add(e.userId); logins.add(e.login); previous = hash(e);
        if (i + 1 === highest && previous !== root) denied();
      }
      if (previous !== proof.root) denied();
      highest = entries.length; root = previous;
      return { entries, root };
    } catch { denied(); }
  }
  return {
    // A mock is deliberately not production-capable, even with valid signatures.
    productionReady: adapter.productionReady === true,
    read,
    async append(userId, login) {
      const work = tail.then(async () => {
        const current = await read();
        const existing = current.entries.find(e => e.userId === userId);
        if (existing) { if (existing.login !== login) denied(); return existing; }
        const entry = {seq: current.entries.length + 1, previous: current.root, userId, login, deletedAt: new Date(now()).toISOString()};
        try { await bounded(() => adapter.appendImmutable(entry, current.root)); } catch {
          // Lost acknowledgement is not failure proof. Only a fresh full read can
          // resolve it; absence/unavailability keeps the caller closed.
        }
        const confirmed = (await read()).entries.find(e => e.userId === userId);
        if (!confirmed || confirmed.login !== login) denied();
        return confirmed;
      });
      tail = work.catch(() => {});
      return work;
    }
  };
}
