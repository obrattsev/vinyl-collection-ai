import { BASE_FIELDS } from '../src/base-record.mjs';
import { validateDraft, recordRevision, recordSnapshot } from '../src/collection-record.mjs';
import { wishlistRevision, wishlistSnapshot } from '../src/wishlist-record.mjs';
import { isPotentialDuplicate } from '../src/collection-rules.mjs';
import { OperationError, createWriteQueue, validateInput, confirmedRecord, appendVerified, deleteVerified } from './record-operations.mjs';

// No transaction or provenance is inferred from a duplicate. Reusing an owned record
// requires the user to select it and confirm both current record revisions.
export function createTransferService(wishlist, collection, serial = createWriteQueue()) {
  const readWishlist = () => wishlist.getWishlist();
  const readCollection = () => collection.getCollection();
  return async (id, expected, input) => serial(async () => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new OperationError(400, 'INVALID_REQUEST');
    const { record: source } = await confirmedRecord(readWishlist, id, expected, wishlistRevision);
    let owned;
    if (Object.hasOwn(input, 'collectionId')) {
      if (Object.keys(input).length !== 2 || !Object.hasOwn(input, 'collectionRevision')) throw new OperationError(400, 'INVALID_REQUEST');
      const { record } = await confirmedRecord(readCollection, input.collectionId, input.collectionRevision, recordRevision);
      if (!isPotentialDuplicate(source, record)) throw new OperationError(409, 'TRANSFER_TARGET_MISMATCH');
      owned = record;
    } else {
      const purchaseFields = ['purchaseDate', 'purchaseStore', 'purchasePrice'];
      if (Object.keys(input).length !== 3 || !purchaseFields.every(field => Object.hasOwn(input, field))) throw new OperationError(400, 'INVALID_RECORD');
      const candidate = { ...Object.fromEntries(BASE_FIELDS.filter(field => field !== 'id').map(field => [field, source[field]])), ...input };
      validateInput(candidate, validateDraft);
      const before = await readCollection();
      // Keep possible prior transfer targets even when edition evidence is incomplete.
      const duplicates = before.filter(record => isPotentialDuplicate(candidate, record));
      if (duplicates.length) throw new OperationError(409, 'POTENTIAL_DUPLICATE', { records: duplicates });
      owned = await appendVerified(collection, readCollection, candidate, before, recordSnapshot);
    }
    try {
      // Source may have changed while creation was in flight. Never delete a new version.
      const { before, record } = await confirmedRecord(readWishlist, id, expected, wishlistRevision);
      await deleteVerified(wishlist, readWishlist, record, expected, before, wishlistSnapshot);
    } catch (error) {
      return { status: 'partial', collectionRecord: owned, wishlistId: id,
        error: 'TRANSFER_DELETE_INCOMPLETE', reason: error instanceof OperationError ? error.message : 'WISHLIST_SOURCE_UNAVAILABLE' };
    }
    return { status: 'complete', collectionRecord: owned, wishlistId: id };
  });
}
