import { validateWishlistDraft, wishlistRevision, wishlistSnapshot } from '../src/wishlist-record.mjs';
import { checkAddition } from '../src/collection-rules.mjs';
import { OperationError, createWriteQueue, validateInput, confirmedRecord, appendVerified, deleteVerified } from './record-operations.mjs';
export function createWishlistService(repository, collectionRepository, serial = createWriteQueue()) {
  const read = () => repository.getWishlist();
  return {
    getWishlist: read,
    createWishlistRecord: input => serial(async () => {
      validateInput(input, validateWishlistDraft);
      const [before, collection] = await Promise.all([read(), collectionRepository.getCollection()]);
      const { blocked, duplicates, ownedDuplicates } = checkAddition(input, 'wishlist', collection, before);
      if (blocked) throw new OperationError(409, 'POTENTIAL_DUPLICATE', { records: [...duplicates, ...ownedDuplicates] });
      return appendVerified(repository, read, input, before, wishlistSnapshot);
    }),
    deleteWishlistRecord: (id, expected) => serial(async () => {
      const { before, record } = await confirmedRecord(read, id, expected, wishlistRevision);
      return deleteVerified(repository, read, record, expected, before, wishlistSnapshot);
    })
  };
}
