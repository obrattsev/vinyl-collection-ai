import test from 'node:test';
import assert from 'node:assert/strict';
import { createCollectionService, OperationError } from '../server/collection-service.mjs';
import { recordRevision, validateDraft, CollectionDataError, validateCollection } from '../src/collection-record.mjs';
import { record } from './fixtures/collection.mjs';

const { id, ...baseDraft } = record;
const draft = overrides => ({ ...baseDraft, album: 'New album', ...overrides });
function memory(initial = [record]) {
  let records = structuredClone(initial);
  const calls = { append: 0, delete: 0, read: 0 };
  const repository = {
    getCollection: async () => { calls.read++; return structuredClone(records); },
    appendRecord: async value => { calls.append++; records.push(structuredClone(value)); },
    deleteRecord: async value => { calls.delete++; records = records.filter(r => r.id !== value.id); }
  };
  return { repository, calls, get records() { return records; } };
}
const fails = (status, code) => error => error instanceof OperationError && error.status === status && error.message === code;

test('draft validation reuses full record rules, rejects IDs, missing and extra fields', () => {
  assert.equal(validateDraft(baseDraft), baseDraft);
  for (const value of [null, [], record, { ...baseDraft, unknown: 1 }, { ...baseDraft, artist: ' ' },
    { ...baseDraft, purchasePrice: '0' }, { ...baseDraft, purchaseDate: '2023-02-29' },
    { ...baseDraft, genre: 'Rock', additionalGenre: ' rock ' }, { ...baseDraft, albumYear: '90' }]) {
    assert.throws(() => validateDraft(value), CollectionDataError);
  }
  const missing = { ...baseDraft }; delete missing.note;
  assert.throws(() => validateDraft(missing), CollectionDataError);
});

test('POST generates UUID, preserves all draft values and other records, returns verified record', async () => {
  const m = memory(); const service = createCollectionService(m.repository);
  const input = Object.freeze(draft({ purchasePrice: 0, note: '=literal', purchaseStore: null }));
  const created = await service.createRecord(input);
  validateCollection([created]);
  assert.notEqual(created.id, record.id);
  assert.deepEqual(created, { ...input, id: created.id });
  assert.deepEqual(m.records, [record, created]);
  assert.deepEqual(m.calls, { append: 1, delete: 0, read: 2 });
});

test('invalid POST makes no read or write, including client-assigned UUID', async () => {
  const m = memory(); const service = createCollectionService(m.repository);
  for (const input of [null, [], record, {}, draft({ albumYear: '199' })]) {
    await assert.rejects(service.createRecord(input), fails(400, 'INVALID_RECORD'));
  }
  assert.deepEqual(m.calls, { append: 0, delete: 0, read: 0 });
});

test('POST blocks confirmed normalized edition duplicates even after user confirmation', async () => {
  const m = memory(); const service = createCollectionService(m.repository);
  for (const input of [baseDraft, { ...baseDraft, artist: ` ${record.artist.toUpperCase()} ` }]) {
    await assert.rejects(service.createRecord(input), error => {
      assert.ok(fails(409, 'POTENTIAL_DUPLICATE')(error));
      assert.deepEqual(error.details.records, [record]); return true;
    });
  }
  assert.equal(m.calls.append, 0);
});

test('POST accepts a proven different edition and an empty collection', async () => {
  for (const initial of [[record], []]) {
    const m = memory(initial);
    const result = await createCollectionService(m.repository).createRecord({ ...baseDraft, label: 'Different label' });
    assert.equal(m.records.length, initial.length + 1);
    assert.equal(result.label, 'Different label');
  }
});

test('POST serializes simultaneous duplicate submissions within the process', async () => {
  const m = memory(); const service = createCollectionService(m.repository);
  const results = await Promise.allSettled([service.createRecord(draft()), service.createRecord(draft())]);
  assert.equal(results[0].status, 'fulfilled');
  assert.ok(fails(409, 'POTENTIAL_DUPLICATE')(results[1].reason));
  assert.equal(m.calls.append, 1);
});

test('POST lost write response is verified without repeating append', async () => {
  const m = memory(); const append = m.repository.appendRecord;
  m.repository.appendRecord = async r => { await append(r); throw new Error('timeout secret'); };
  const result = await createCollectionService(m.repository).createRecord(draft());
  assert.equal(result.id, m.records[1].id); assert.equal(m.calls.append, 1);
});

test('POST missing, altered, unreadable or collateral result is unconfirmed, never retried', async () => {
  for (const behavior of ['missing', 'altered', 'unreadable', 'collateral']) {
    const m = memory(); const append = m.repository.appendRecord;
    m.repository.appendRecord = async r => {
      if (behavior === 'missing') { m.calls.append++; throw new Error('timeout'); }
      await append(behavior === 'altered' ? { ...r, note: 'changed' } : r);
      if (behavior === 'unreadable') m.repository.getCollection = async () => { throw new Error('secret'); };
      if (behavior === 'collateral') m.records[0].album = 'Changed';
    };
    await assert.rejects(createCollectionService(m.repository).createRecord(draft()), fails(500, 'RESULT_UNCONFIRMED'));
    assert.equal(m.calls.append, 1);
  }
});

test('DELETE checks confirmation revision and removes exactly selected UUID, preserving neighbor', async () => {
  const other = { ...record, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', album: 'Other' };
  const m = memory([record, other]);
  const deleted = await createCollectionService(m.repository).deleteRecord(other.id.toUpperCase(), await recordRevision(other));
  assert.deepEqual(deleted, other); assert.deepEqual(m.records, [record]);
  assert.deepEqual(m.calls, { append: 0, delete: 1, read: 2 });
});

test('DELETE invalid UUID/revision, vanished and changed records never reach deletion', async () => {
  const m = memory(); const service = createCollectionService(m.repository);
  for (const args of [['bad', await recordRevision(record)], [id, undefined], [id, '*']]) {
    await assert.rejects(service.deleteRecord(...args), fails(400, 'INVALID_REQUEST'));
  }
  await assert.rejects(service.deleteRecord('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', await recordRevision(record)), fails(404, 'NOT_FOUND'));
  await assert.rejects(service.deleteRecord(id, await recordRevision({ ...record, note: 'old' })), error => {
    assert.ok(fails(409, 'RECORD_CHANGED')(error)); assert.deepEqual(error.details.record, record); return true;
  });
  assert.equal(m.calls.delete, 0);
});

test('DELETE lost response can be verified; repeated DELETE reports 404', async () => {
  const m = memory(); const remove = m.repository.deleteRecord;
  m.repository.deleteRecord = async r => { await remove(r); throw new Error('timeout'); };
  const service = createCollectionService(m.repository); const revision = await recordRevision(record);
  assert.deepEqual(await service.deleteRecord(id, revision), record);
  await assert.rejects(service.deleteRecord(id, revision), fails(404, 'NOT_FOUND'));
  assert.equal(m.calls.delete, 1);
});

test('DELETE remaining target, missing neighbor or unreadable result is not success', async () => {
  for (const behavior of ['remaining', 'neighbor', 'unreadable']) {
    const neighbor = { ...record, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    const m = memory([record, neighbor]);
    m.repository.deleteRecord = async () => {
      m.calls.delete++;
      if (behavior === 'remaining') throw new Error('timeout');
      m.records.splice(0, 2);
      if (behavior === 'unreadable') m.repository.getCollection = async () => { throw new Error('timeout'); };
    };
    await assert.rejects(createCollectionService(m.repository).deleteRecord(id, await recordRevision(record)), fails(500, 'RESULT_UNCONFIRMED'));
    assert.equal(m.calls.delete, 1);
  }
});

test('DELETE propagates a last-moment data conflict without treating it as success', async () => {
  const m = memory(); m.repository.deleteRecord = async () => { throw new OperationError(409, 'RECORD_CHANGED', { record }); };
  await assert.rejects(createCollectionService(m.repository).deleteRecord(id, await recordRevision(record)), fails(409, 'RECORD_CHANGED'));
});

test('confirmation digest is stable across key order and covers every field', async () => {
  const revision = await recordRevision(record);
  assert.equal(await recordRevision(Object.fromEntries(Object.entries(record).reverse())), revision);
  for (const field of Object.keys(record)) assert.notEqual(await recordRevision({ ...record, [field]: 'different' }), revision);
});
