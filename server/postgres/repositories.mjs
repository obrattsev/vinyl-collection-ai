import { COLLECTION_FIELDS, validateCollection, recordRevision } from '../../src/collection-record.mjs';
import { WISHLIST_FIELDS, validateWishlist, wishlistRevision } from '../../src/wishlist-record.mjs';
import { UUID } from '../../src/base-record.mjs';
import { OperationError } from '../record-operations.mjs';
const models = Object.freeze({ collection: { table: 'collection_records', fields: COLLECTION_FIELDS, validate: validateCollection, revision: recordRevision },
  wishlist: { table: 'wishlist_records', fields: WISHLIST_FIELDS, validate: validateWishlist, revision: wishlistRevision } });
const column = field => field.replace(/[A-Z]/g, char => '_' + char.toLowerCase());
export const validId = id => { if (typeof id !== 'string' || !UUID.test(id)) throw new OperationError(400, 'INVALID_REQUEST'); return id.toLowerCase(); };
export const validRevision = value => { if (!/^"[a-f0-9]{64}"$/.test(value || '')) throw new OperationError(400, 'INVALID_REQUEST'); return value; };
// Section is selected from constants, never interpolated from a request/identifier.
export function recordRepository(queryable, userId, section) {
  userId = validId(userId);
  const model = models[section]; if (!model) throw Error('Invalid record section');
  const table = `vinyl.${model.table}`;
  const columns = model.fields.map(column);
  const selection = columns.join(',');
  function dto(row) {
    const record = Object.fromEntries(model.fields.map(field => [field, field === 'purchasePrice' && row.purchase_price !== null ? Number(row.purchase_price) : row[column(field)]]));
    model.validate([record]); return record;
  }
  async function get(id) {
    const { rows } = await queryable.query(`SELECT ${selection} FROM ${table} WHERE user_id=$1 AND id=$2`, [userId,validId(id)]);
    return rows.length ? dto(rows[0]) : null;
  }
  async function conflict(id) {
    const record = await get(id);
    if (!record) throw new OperationError(404, 'NOT_FOUND');
    throw new OperationError(409, 'RECORD_CHANGED', { record });
  }
  return {
    get,
    list: async () => (await queryable.query(`SELECT ${selection} FROM ${table} WHERE user_id=$1 ORDER BY position,id`, [userId])).rows.map(dto),
    async insert(record) {
      model.validate([record]);
      record = { ...record,id:validId(record.id) };
      const revision = await model.revision(record);
      const values = model.fields.map(field => record[field]);
      const { rows } = await queryable.query(`INSERT INTO ${table} (${selection},user_id,revision) VALUES (${values.map((_,i) => '$'+(i+1)).join(',')},$${values.length+1},$${values.length+2}) RETURNING ${selection}`, [...values,userId,revision]);
      return dto(rows[0]);
    },
    async update(record, expected) {
      model.validate([record]); validRevision(expected);
      record = { ...record,id:validId(record.id) };
      const fields = model.fields.filter(field => field !== 'id');
      const values = fields.map(field => record[field]);
      const offset = values.length;
      const { rows } = await queryable.query(`UPDATE ${table} SET ${fields.map((field,i) => column(field)+'=$'+(i+1)).join(',')},
        revision=$${offset+1}, version=version+1, updated_at=clock_timestamp()
        WHERE user_id=$${offset+2} AND id=$${offset+3} AND revision=$${offset+4} RETURNING ${selection}`,
        [...values, await model.revision(record),userId,validId(record.id),expected]);
      if (!rows.length) return conflict(record.id);
      return dto(rows[0]);
    },
    async remove(id, expected) {
      const { rows } = await queryable.query(`DELETE FROM ${table} WHERE user_id=$1 AND id=$2 AND revision=$3 RETURNING ${selection}`, [userId,validId(id),validRevision(expected)]);
      if (!rows.length) return conflict(id);
      return dto(rows[0]);
    }
  };
}
export async function ownerTransaction(pool, userId, work) {
  userId = validId(userId);
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT id FROM vinyl.users WHERE id=$1 FOR UPDATE', [userId]);
    if (!result.rowCount) throw new OperationError(404, 'NOT_FOUND');
    const value = await work(client); await client.query('COMMIT'); return value;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { broken = true; }
    throw error;
  } finally { client.release(broken); }
}
export function coverRepository(queryable, userId) {
  userId = validId(userId);
  return {
    async insert(id) {
      id = validId(id);
      await queryable.query('INSERT INTO vinyl.covers(id,user_id,storage_key) VALUES ($1,$2,$3)',[id,userId,id]);
    },
    async get(id) {
      return (await queryable.query('SELECT id,storage_key AS "storageKey" FROM vinyl.covers WHERE user_id=$1 AND id=$2',[userId,validId(id)])).rows[0] ?? null;
    },
    // Read-only handoff for future cleanup: rows retain paths until files are removed.
    async unreferenced() {
      return (await queryable.query(`SELECT c.id,c.storage_key AS "storageKey" FROM vinyl.covers c WHERE c.user_id=$1
        AND NOT EXISTS (SELECT 1 FROM vinyl.collection_records r WHERE r.user_id=c.user_id AND r.cover_id=c.id)
        AND NOT EXISTS (SELECT 1 FROM vinyl.wishlist_records r WHERE r.user_id=c.user_id AND r.cover_id=c.id) ORDER BY c.id`, [userId])).rows;
    }
  };
}
