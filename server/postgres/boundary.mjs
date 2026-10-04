import { OperationError } from '../record-operations.mjs';
import { validId } from './repositories.mjs';

// Temporary single authenticated owner bridge. Request headers/body never select identity.
export function ownerBoundary(pool, ownerId) {
  ownerId = validId(ownerId);
  return {
    async authorizeList(section, session) {
      const column = { collection:'collection_public', wishlist:'wishlist_public' }[section];
      if (!column) throw new OperationError(404,'NOT_FOUND');
      const row = (await pool.query(`SELECT ${column} AS public FROM vinyl.users WHERE id=$1`,[ownerId])).rows[0];
      if (!row || (!session && !row.public)) throw new OperationError(404,'NOT_FOUND');
    },
    async authorizeCover(id, session) {
      const rows = (await pool.query(`SELECT c.id FROM vinyl.covers c JOIN vinyl.users u ON u.id=c.user_id
        WHERE c.id=$1 AND c.user_id=$2 AND (
          EXISTS (SELECT 1 FROM vinyl.collection_records r WHERE r.user_id=c.user_id AND r.cover_id=c.id AND ($3 OR u.collection_public))
          OR EXISTS (SELECT 1 FROM vinyl.wishlist_records r WHERE r.user_id=c.user_id AND r.cover_id=c.id AND ($3 OR u.wishlist_public)))`,
        [validId(id),ownerId,Boolean(session)])).rows;
      if (!rows.length) throw new OperationError(404,'NOT_FOUND');
    }
  };
}
export async function freeze(pool, enabled) {
  if (typeof enabled !== 'boolean') throw Error('Explicit freeze state required');
  const client=await pool.connect();let broken=false;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(44160403)');
    const {rows}=await client.query('UPDATE vinyl.runtime_control SET frozen=$1,changed_at=clock_timestamp() WHERE singleton RETURNING *',[enabled]);
    if (!rows.length) throw Error('Missing runtime control');
    await client.query('COMMIT');return {...rows[0],drained:enabled};
  } catch(error) {try{await client.query('ROLLBACK');}catch{broken=true;}throw error;}
  finally{client.release(broken);}
}
