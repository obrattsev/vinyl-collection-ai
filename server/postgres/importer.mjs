import { createHash } from 'node:crypto';
import { mapSheetValues } from '../google-sheets-collection.mjs';
import { mapWishlistValues } from '../google-sheets-wishlist.mjs';
import { COLLECTION_FIELDS, validateCollection } from '../../src/collection-record.mjs';
import { WISHLIST_FIELDS, validateWishlist } from '../../src/wishlist-record.mjs';
import { userInput, insertUser } from './users.mjs';
import { recordRepository, coverRepository, validId } from './repositories.mjs';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function validateSnapshot(snapshot) {
  if (!snapshot || !snapshot.user?.id || typeof snapshot.importKey !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(snapshot.importKey)) throw Error('Invalid import manifest');
  const user = userInput(snapshot.user);
  for (const section of ['collection', 'wishlist']) {
    if (Object.hasOwn(snapshot, section) === Object.hasOwn(snapshot, `${section}Values`)) {
      throw Error('Exactly one input representation is required for each section');
    }
  }
  const canonical = (record, fields) => Object.fromEntries(fields.map(key => [key,key === 'id' ? validId(record.id) : record[key]]));
  const collection = snapshot.collectionValues ? mapSheetValues(snapshot.collectionValues) : validateCollection(snapshot.collection);
  const wishlist = snapshot.wishlistValues ? mapWishlistValues(snapshot.wishlistValues) : validateWishlist(snapshot.wishlist);
  const normalized = { user, collection:collection.map(r => canonical(r,COLLECTION_FIELDS)), wishlist:wishlist.map(r => canonical(r,WISHLIST_FIELDS)) };
  // Explicit cover inventory; unreferenced objects can be retained for later reconciliation.
  if (!Array.isArray(snapshot.covers)) throw Error('Cover inventory required');
  const covers = snapshot.covers.map(validId).sort();
  if (new Set(covers).size !== covers.length) throw Error('Duplicate cover UUID');
  if ([...collection,...wishlist].some(r => r.coverId && !covers.includes(r.coverId))) throw Error('Missing cover inventory reference');
  const manifest = { ...normalized,covers };
  return { ...manifest,importKey:snapshot.importKey,manifestHash:hash(manifest),report:{ collection:collection.length,wishlist:wishlist.length,
    favorites:collection.filter(r => r.favorite).length,covers:covers.length,recordsHash:hash([normalized.collection,normalized.wishlist]),
    canonicalizedIds:[...collection,...wishlist].filter(r => r.id !== r.id.toLowerCase()).length } };
}
export async function importSnapshot(pool, snapshot, { dryRun = true } = {}) {
  const data = validateSnapshot(snapshot);
  if (dryRun) return { status:'validated',...data.report,manifestHash:data.manifestHash };
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    // Serial import gate prevents same-key and same-owner races without partial users.
    await client.query('SELECT pg_advisory_xact_lock(44160402)');
    const previous = (await client.query('SELECT manifest_hash,report FROM vinyl.data_imports WHERE import_key=$1',[data.importKey])).rows[0];
    if (previous) {
      if (previous.manifest_hash !== data.manifestHash) throw Error('Import manifest conflict');
      await client.query('COMMIT');
      return { status:'already_imported',...previous.report,manifestHash:data.manifestHash };
    }
    const { emailNormalized, ...input } = data.user;
    await insertUser(client,input);
    const covers = coverRepository(client,data.user.id);
    for (const id of data.covers) await covers.insert(id);
    for (const section of ['collection','wishlist']) {
      const repo = recordRepository(client,data.user.id,section);
      for (const record of data[section]) await repo.insert(record);
      if (hash(await repo.list()) !== hash(data[section])) throw Error('Import verification failed');
    }
    await client.query('INSERT INTO vinyl.data_imports(import_key,manifest_hash,user_id,report) VALUES ($1,$2,$3,$4)',[data.importKey,data.manifestHash,data.user.id,data.report]);
    await client.query('COMMIT');
    return { status:'imported',...data.report,manifestHash:data.manifestHash };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { broken = true; }
    throw error;
  } finally { client.release(broken); }
}
