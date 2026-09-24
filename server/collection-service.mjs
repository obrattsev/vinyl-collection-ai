import { validateDraft, recordRevision, recordSnapshot } from '../src/collection-record.mjs';
import { checkAddition } from '../src/collection-rules.mjs';
import { OperationError, createWriteQueue, validateInput, confirmedRecord, appendVerified, deleteVerified, updateVerified, sameId } from './record-operations.mjs';
export { OperationError } from './record-operations.mjs';
export function createCollectionService(repository, serial = createWriteQueue()) {
  const read = () => repository.getCollection();
  return {
    getCollection: read,
    createRecord: input => serial(async () => {
      validateInput(input, validateDraft);
      const before = await read();
      const { duplicates } = checkAddition(input, 'collection', before);
      if (duplicates.length) throw new OperationError(409, 'POTENTIAL_DUPLICATE', { records: duplicates });
      return appendVerified(repository, read, input, before, recordSnapshot);
    }),
    updateRecord: (id, expected, input) => serial(async () => {
      validateInput(input, validateDraft);
      const { before, record } = await confirmedRecord(read, id, expected, recordRevision);
      const { blocked, duplicates, ownedDuplicates } = checkAddition(input, 'collection', before.filter(r => !sameId(r.id, id)));
      if (blocked) throw new OperationError(409, 'POTENTIAL_DUPLICATE', { records: [...duplicates, ...ownedDuplicates] });
      return updateVerified(repository, read, record, input, expected, before, recordSnapshot);
    }),
    deleteRecord: (id, expected) => serial(async () => {
      const { before, record } = await confirmedRecord(read, id, expected, recordRevision);
      return deleteVerified(repository, read, record, expected, before, recordSnapshot);
    })
  };
}
