import { randomUUID } from 'node:crypto';
import { transaction } from './auth-store.mjs';
import { OperationError } from '../record-operations.mjs';
// Covers become inaccessible through ownership before physical cleanup. Cleanup
// metadata survives deletion. No direct filesystem path comes from the ledger.
export async function applyDeletionEntries(client, entries, ownerId, {restoring=false}={}) {
  await client.query(restoring ? 'SELECT pg_advisory_xact_lock(44160403)' : 'SELECT pg_advisory_xact_lock_shared(44160403)');
  if(!restoring && entries.length && (await client.query('SELECT frozen FROM vinyl.runtime_control WHERE singleton')).rows[0]?.frozen)throw Error('Reconciliation requires maintenance with backup idle');
  for (const entry of entries) {
    if (entry.userId === ownerId || (await client.query('SELECT 1 FROM vinyl.mirror_state WHERE user_id=$1', [entry.userId])).rowCount) throw Error('Protected ledger subject');
    const user = (await client.query('SELECT login_normalized,email_normalized FROM vinyl.users WHERE id=$1 FOR UPDATE', [entry.userId])).rows[0];
    if (user && user.login_normalized !== entry.login) throw Error('Ledger identity conflict');
    if ((await client.query('SELECT 1 FROM vinyl.users WHERE login_normalized=$1 AND id<>$2', [entry.login, entry.userId])).rowCount) throw Error('Ledger login conflict');
    await client.query('INSERT INTO vinyl.login_reservations(login_normalized) VALUES($1) ON CONFLICT DO NOTHING', [entry.login]);
    if (!user) continue;
    await client.query('INSERT INTO vinyl.cover_cleanup(id,user_id,storage_key) SELECT id,user_id,storage_key FROM vinyl.covers WHERE user_id=$1 ON CONFLICT DO NOTHING', [entry.userId]);
    await client.query('DELETE FROM vinyl.collection_records WHERE user_id=$1', [entry.userId]);
    await client.query('DELETE FROM vinyl.wishlist_records WHERE user_id=$1', [entry.userId]);
    await client.query('DELETE FROM vinyl.covers WHERE user_id=$1', [entry.userId]);
    await client.query('DELETE FROM vinyl.auth_flows WHERE user_id=$1 OR email_normalized=$2', [entry.userId, user.email_normalized]);
    await client.query('DELETE FROM vinyl.users WHERE id=$1', [entry.userId]);
  }
}
export function createDeletionSafety({ pool, ledger, ownerId }) {
  return {
    ledger,
    async ready() {
      try {
        const {entries} = await ledger.read();
        await transaction(pool, client => applyDeletionEntries(client, entries, ownerId));
      } catch { throw new OperationError(503, 'DELETION_SAFETY_UNAVAILABLE'); }
    },
    async restore() {
      // Explicit disaster restore only, never an ordinary startup side effect.
      // Caller keeps ingress/mirror/cleanup OFF until this transaction succeeds.
      // Without an external ledger, old-backup deletions cannot be reconstructed.
      const {entries} = ledger ? await ledger.read() : {entries:[]};
      await transaction(pool, async client => {
        await applyDeletionEntries(client, entries, ownerId, {restoring:true});
        // Preserve eligibility only for active users or this database's current quarantine.
        const eligible=(await client.query(`SELECT a.user_id,u.email,u.email_normalized FROM vinyl.user_auth a
          JOIN vinyl.users u ON u.id=a.user_id LEFT JOIN vinyl.restore_quarantine q ON q.user_id=a.user_id
          LEFT JOIN vinyl.restore_epoch e ON e.restore_id=q.restore_id
          WHERE a.status='active' OR (a.status='disabled' AND e.singleton AND q.auth_version=a.auth_version)`)).rows;
        await client.query('DELETE FROM vinyl.restore_recovery_grants');
        await client.query('DELETE FROM vinyl.restore_quarantine');
        await client.query('DELETE FROM vinyl.restore_epoch');
        const restoreId=randomUUID();
        await client.query('INSERT INTO vinyl.restore_epoch(restore_id) VALUES($1)',[restoreId]);
        await client.query('DELETE FROM vinyl.auth_sessions');
        await client.query('DELETE FROM vinyl.auth_flows');
        await client.query("UPDATE vinyl.user_auth SET status='disabled',auth_version=auth_version+1");
        await client.query('UPDATE vinyl.users SET collection_public=false,wishlist_public=false');
        for(const user of eligible)await client.query(`INSERT INTO vinyl.restore_quarantine(user_id,restore_id,auth_version,email,email_normalized)
          SELECT user_id,$2,auth_version,$3,$4 FROM vinyl.user_auth WHERE user_id=$1`,[user.user_id,restoreId,user.email,user.email_normalized]);
      });
      return {state:'quarantined', loginRequiresRecovery:true, privacyRequiresConfirmation:true};
    }
  };
}

export async function requireWorkerSafety(pool, safety, userId) {
  const installed=(await pool.query("SELECT to_regclass('vinyl.user_auth') AS name")).rows[0].name;
  if(!installed)return; // Existing Stage 4B deployment remains compatible.
  if(safety)await safety.ready();
  // Restore blocks mirror until its subject has completed recovery. Never rely
  // on worker startup alone: reconcile checks this under the maintenance lock.
  const epoch=(await pool.query("SELECT to_regclass('vinyl.restore_epoch') AS name")).rows[0].name;
  if(!epoch)throw Error('Auth restore schema required before mirror writes');
  if((await pool.query(`SELECT 1 FROM vinyl.restore_epoch WHERE singleton AND EXISTS(
    SELECT 1 FROM vinyl.users u LEFT JOIN vinyl.user_auth a ON a.user_id=u.id
    WHERE ($1::uuid IS NULL OR u.id=$1) AND (a.status IS DISTINCT FROM 'active'))`,[userId || null])).rowCount)throw Error('RESTORE_QUARANTINE');
}
export async function quarantineRestoredAuth(pool, safety) {
  const installed=(await pool.query("SELECT to_regclass('vinyl.user_auth') AS name")).rows[0].name;
  if(!installed)return {present:false};
  return (safety || createDeletionSafety({pool})).restore();
}
