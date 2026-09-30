import { recordRevision, recordSnapshot } from '../src/collection-record.mjs';
import { wishlistRevision, wishlistSnapshot } from '../src/wishlist-record.mjs';
import { OperationError, confirmedRecord, updateVerified } from './record-operations.mjs';

export function createPresentationService({ collection, wishlist, covers, serial }) {
  const source = section => section === 'collection'
    ? { repository: collection, read: () => collection.getCollection(), revision: recordRevision, snapshot: recordSnapshot }
    : { repository: wishlist, read: () => wishlist.getWishlist(), revision: wishlistRevision, snapshot: wishlistSnapshot };
  return {
    coverStorage: covers,
    changeCover: (section, id, expected, bytes) => serial(async () => {
      if (!covers) throw new OperationError(503, 'COVERS_NOT_CONFIGURED');
      const { repository, read, revision, snapshot } = source(section);
      if (!repository) throw new OperationError(503, 'WISHLIST_NOT_CONFIGURED');
      const { before, record } = await confirmedRecord(read, id, expected, revision);
      const coverId = bytes === null ? null : await covers.prepare(bytes);
      const hold = await covers.hold([record.coverId, coverId]);
      // Any thrown result keeps the durable hold: even an apparently absent result
      // might arrive late from Google. No retry, rollback, or orphan deletion here.
      const result = await updateVerified(repository, read, record, { ...record, coverId }, expected, before, snapshot);
      try {
        await covers.release(hold);
        const all = [...await collection.getCollection(), ...await (wishlist?.getWishlist() ?? [])];
        await covers.removeUnreferenced(record.coverId, all);
      } catch { /* Successful link update remains success; cleanup can wait safely. */ }
      return result;
    }),
    changeFavorite: (id, expected, input) => serial(async () => {
      if (!input || Object.keys(input).length !== 1 || typeof input.favorite !== 'boolean') throw new OperationError(400, 'INVALID_REQUEST');
      const read = () => collection.getCollection();
      const { before, record } = await confirmedRecord(read, id, expected, recordRevision);
      return updateVerified(collection, read, record, { ...record, favorite: input.favorite }, expected, before, recordSnapshot);
    })
  };
}
