import { randomUUID } from 'node:crypto';
import { UUID, validateDraft, recordRevision, recordSnapshot } from '../src/collection-record.mjs';
import { checkAddition } from '../src/collection-rules.mjs';

export class OperationError extends Error {
  constructor(status, code, details = {}) { super(code); this.status = status; this.details = details; }
}
const same = (a, b) => recordSnapshot(a) === recordSnapshot(b);
export function createCollectionService(repository) {
  // Serialize local writes: duplicate checks and row lookup must see the previous result.
  let pending = Promise.resolve();
  const serial = fn => { const result = pending.then(fn); pending = result.catch(() => {}); return result; };
  return {
    getCollection: () => repository.getCollection(),
    createRecord: input => serial(async () => {
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.hasOwn(input, 'id')) throw new OperationError(400, 'INVALID_RECORD');
      const candidate = { ...input, id: randomUUID() };
      try { validateDraft(input); } catch { throw new OperationError(400, 'INVALID_RECORD'); }
      const before = await repository.getCollection();
      const { duplicates } = checkAddition(candidate, 'collection', before);
      if (duplicates.length) throw new OperationError(409, 'POTENTIAL_DUPLICATE', { records: duplicates });
      try { await repository.appendRecord(candidate); } catch { /* Verify even if the response was lost. */ }
      let after;
      try { after = await repository.getCollection(); } catch { throw new OperationError(500, 'RESULT_UNCONFIRMED', { id: candidate.id }); }
      const actual = after.find(r => r.id.toLowerCase() === candidate.id.toLowerCase());
      if (!actual || !same(actual, candidate) || before.some(r => !after.some(a => a.id === r.id && same(a, r)))) throw new OperationError(500, 'RESULT_UNCONFIRMED', { id: candidate.id });
      return actual;
    }),
    deleteRecord: (id, expected) => serial(async () => {
      if ((typeof id !== 'string' || !UUID.test(id)) || !/^"[a-f0-9]{64}"$/.test(expected || '')) throw new OperationError(400, 'INVALID_REQUEST');
      const before = await repository.getCollection();
      const record = before.find(r => r.id.toLowerCase() === id.toLowerCase());
      if (!record) throw new OperationError(404, 'NOT_FOUND');
      if (await recordRevision(record) !== expected) throw new OperationError(409, 'RECORD_CHANGED', { record });
      try { await repository.deleteRecord(record, expected); } catch (error) {
        if (error instanceof OperationError) throw error;
      }
      let after;
      try { after = await repository.getCollection(); } catch { throw new OperationError(500, 'RESULT_UNCONFIRMED', { id }); }
      if (after.some(r => r.id.toLowerCase() === id.toLowerCase()) || before.filter(r => r.id !== record.id).some(r => !after.some(a => a.id === r.id && same(a, r)))) throw new OperationError(500, 'RESULT_UNCONFIRMED', { id });
      return record;
    })
  };
}
