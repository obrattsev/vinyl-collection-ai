import { randomUUID } from 'node:crypto';
import { UUID } from '../src/base-record.mjs';
export class OperationError extends Error {
  constructor(status, code, details = {}) { super(code); this.status = status; this.details = details; }
}
export function createWriteQueue() {
  let pending = Promise.resolve();
  return fn => { const result = pending.then(fn); pending = result.catch(() => {}); return result; };
}
export const sameId = (a, b) => a.toLowerCase() === b.toLowerCase();
export function validateInput(input, validate) {
  try { validate(input); } catch { throw new OperationError(400, 'INVALID_RECORD'); }
}
export async function confirmedRecord(read, id, expected, revision) {
  if (typeof id !== 'string' || !UUID.test(id) || !/^"[a-f0-9]{64}"$/.test(expected || '')) throw new OperationError(400, 'INVALID_REQUEST');
  const before = await read();
  const record = before.find(r => sameId(r.id, id));
  if (!record) throw new OperationError(404, 'NOT_FOUND');
  if (await revision(record) !== expected) throw new OperationError(409, 'RECORD_CHANGED', { record });
  return { before, record };
}
function preserved(before, after, snapshot) {
  return before.every(r => after.some(a => sameId(a.id, r.id) && snapshot(a) === snapshot(r)));
}
export async function appendVerified(repository, read, input, before, snapshot) {
  const candidate = { ...input, id: randomUUID() };
  // Never retry a write, including a lost response. Verify what actually happened.
  try { await repository.appendRecord(candidate); } catch { /* Read below. */ }
  let after;
  try { after = await read(); } catch { throw new OperationError(500, 'RESULT_UNCONFIRMED', { id: candidate.id }); }
  const actual = after.find(r => sameId(r.id, candidate.id));
  if (!actual || snapshot(actual) !== snapshot(candidate) || !preserved(before, after, snapshot)) throw new OperationError(500, 'RESULT_UNCONFIRMED', { id: candidate.id });
  return actual;
}
export async function deleteVerified(repository, read, record, expected, before, snapshot) {
  try { await repository.deleteRecord(record, expected); } catch (error) {
    if (error instanceof OperationError) throw error;
  }
  let after;
  try { after = await read(); } catch { throw new OperationError(500, 'RESULT_UNCONFIRMED', { id: record.id }); }
  if (after.some(r => sameId(r.id, record.id)) || !preserved(before.filter(r => !sameId(r.id, record.id)), after, snapshot)) throw new OperationError(500, 'RESULT_UNCONFIRMED', { id: record.id });
  return record;
}

export async function updateVerified(repository, read, record, input, expected, before, snapshot) {
  const candidate = { ...input, id: record.id };
  try { await repository.updateRecord(candidate, expected); } catch (error) {
    if (error instanceof OperationError) throw error;
  }
  let after;
  try { after = await read(); } catch { throw new OperationError(500, 'RESULT_UNCONFIRMED', { id: record.id }); }
  const actual = after.find(r => sameId(r.id, record.id));
  if (!actual || snapshot(actual) !== snapshot(candidate) ||
      !preserved(before.filter(r => !sameId(r.id, record.id)), after, snapshot)) {
    throw new OperationError(500, 'RESULT_UNCONFIRMED', { id: record.id });
  }
  return actual;
}
