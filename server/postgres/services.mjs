import { randomUUID } from 'node:crypto';
import { BASE_FIELDS } from '../../src/base-record.mjs';
import { validateDraft, recordRevision } from '../../src/collection-record.mjs';
import { validateWishlistDraft, wishlistRevision } from '../../src/wishlist-record.mjs';
import { checkAddition, isPotentialDuplicate } from '../../src/collection-rules.mjs';
import { OperationError, validateInput } from '../record-operations.mjs';
import { recordRepository, coverRepository, ownerTransaction, validId, validRevision } from './repositories.mjs';

export function createPostgresServices(pool, userId, covers = null) {
  userId = validId(userId);
  const repo = (client, section) => recordRepository(client, userId, section);
  const write = work => ownerTransaction(pool, userId, work);
  async function confirmed(client, section, id, expected) {
    validId(id); validRevision(expected);
    const record = await repo(client, section).get(id);
    if (!record) throw new OperationError(404, 'NOT_FOUND');
    if (await (section === 'collection' ? recordRevision : wishlistRevision)(record) !== expected) throw new OperationError(409, 'RECORD_CHANGED', { record });
    return record;
  }
  async function duplicates(client, section, input, except) {
    const collection = (await repo(client,'collection').list()).filter(r => section !== 'collection' || r.id !== except);
    const wishlist = section === 'wishlist' ? (await repo(client,'wishlist').list()).filter(r => r.id !== except) : [];
    const result = checkAddition(input,section,collection,wishlist);
    if (result.blocked) throw new OperationError(409,'POTENTIAL_DUPLICATE',{ records: [...result.duplicates,...result.ownedDuplicates] });
  }
  const create = (section,input) => write(async client => {
    validateInput(input,section === 'collection' ? validateDraft : validateWishlistDraft);
    await duplicates(client,section,input);
    return repo(client,section).insert({ ...input,id:randomUUID(),coverId:null,...(section === 'collection' ? {favorite:false} : {}) });
  });
  const update = (section,id,expected,input) => write(async client => {
    validateInput(input,section === 'collection' ? validateDraft : validateWishlistDraft);
    const record = await confirmed(client,section,id,expected);
    await duplicates(client,section,input,record.id);
    return repo(client,section).update({ ...record,...input },expected);
  });
  const remove = (section,id,expected) => write(client => repo(client,section).remove(id,expected));
  return {
    getCollection: () => repo(pool,'collection').list(),
    getWishlist: () => repo(pool,'wishlist').list(),
    createRecord: input => create('collection',input),
    createWishlistRecord: input => create('wishlist',input),
    updateRecord: (id,expected,input) => update('collection',id,expected,input),
    updateWishlistRecord: (id,expected,input) => update('wishlist',id,expected,input),
    deleteRecord: (id,expected) => remove('collection',id,expected),
    deleteWishlistRecord: (id,expected) => remove('wishlist',id,expected),
    changeFavorite: (id,expected,input) => write(async client => {
      if (!input || Object.keys(input).length !== 1 || typeof input.favorite !== 'boolean') throw new OperationError(400,'INVALID_REQUEST');
      const record = await confirmed(client,'collection',id,expected);
      return repo(client,'collection').update({ ...record,favorite:input.favorite },expected);
    }),
    coverStorage: covers,
    changeCover: (section,id,expected,bytes) => write(async client => {
      if (!['collection','wishlist'].includes(section)) throw new OperationError(400,'INVALID_REQUEST');
      if (!covers) throw new OperationError(503,'COVERS_NOT_CONFIGURED');
      const record = await confirmed(client,section,id,expected);
      const coverId = bytes === null ? null : await covers.prepare(bytes);
      if (coverId) await coverRepository(client,userId).insert(coverId);
      // Metadata kept after unlink; no physical deletion inside a DB transaction.
      // A failed DB commit can leave a prepared file; 4B reconciles filesystem orphans.
      return repo(client,section).update({ ...record,coverId },expected);
    }),
    transferRecord: (id,expected,input) => write(async client => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new OperationError(400,'INVALID_REQUEST');
      const source = await confirmed(client,'wishlist',id,expected);
      let target;
      if (Object.hasOwn(input,'collectionId')) {
        if (Object.keys(input).length !== 2 || !Object.hasOwn(input,'collectionRevision')) throw new OperationError(400,'INVALID_REQUEST');
        target = await confirmed(client,'collection',input.collectionId,input.collectionRevision);
        if (!isPotentialDuplicate(source,target)) throw new OperationError(409,'TRANSFER_TARGET_MISMATCH');
      } else {
        const purchase = ['purchaseDate','purchaseStore','purchasePrice'];
        if (Object.keys(input).length !== 3 || !purchase.every(key => Object.hasOwn(input,key))) throw new OperationError(400,'INVALID_RECORD');
        const candidate = { ...Object.fromEntries(BASE_FIELDS.filter(key => key !== 'id').map(key => [key,source[key]])),...input };
        validateInput(candidate,validateDraft);
        const matches = (await repo(client,'collection').list()).filter(record => isPotentialDuplicate(candidate,record));
        if (matches.length) throw new OperationError(409,'POTENTIAL_DUPLICATE',{ records:matches });
        target = await repo(client,'collection').insert({ ...candidate,id:randomUUID(),coverId:source.coverId,favorite:false });
      }
      await repo(client,'wishlist').remove(source.id,expected);
      return { status:'complete',collectionRecord:target,wishlistId:source.id };
    })
  };
}
