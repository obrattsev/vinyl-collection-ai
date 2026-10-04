import { createHash } from 'node:crypto';
import { recordRepository, validId } from './repositories.mjs';
export const MIRROR_LOCK = 44160404;
export const stateHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function snapshotReport(snapshot) {
  return Object.fromEntries(['collection','wishlist'].map(section=>[section,{count:snapshot[section].length,hash:stateHash(snapshot[section])}]));
}
export async function mirrorStatus(pool,userId) {
  const row=(await pool.query(`SELECT *, EXTRACT(EPOCH FROM (clock_timestamp()-dirty_since)) AS lag_seconds
    FROM vinyl.mirror_state WHERE user_id=$1`,[validId(userId)])).rows[0];
  if (!row) throw Error('Mirror is not provisioned');
  return {...row,status:row.last_error?'failed':row.generation!==row.synced_generation?'pending':'synced'};
}
export async function enableMirror(pool,userId) {
  // Explicit operator step, never implicit on startup.
  await pool.query('INSERT INTO vinyl.mirror_state(user_id) VALUES ($1) ON CONFLICT DO NOTHING',[validId(userId)]);
}
export async function reconcile(pool,userId,adapter,{force=false,random=Math.random}={}) {
  userId=validId(userId);
  const client=await pool.connect();let locked=false,broken=false,attempted=false;
  const disconnected=()=>{broken=true;};client.on('error',disconnected);
  async function checkConnection(){if(broken)throw Error('Mirror lock lost');await client.query('SELECT 1');}
  try {
    locked=(await client.query('SELECT pg_try_advisory_lock($1) AS locked',[MIRROR_LOCK])).rows[0].locked;
    if (!locked) return {status:'busy'};
    const state=await mirrorStatus(client,userId);
    if (!force && new Date(state.next_attempt_at).getTime()>Date.now()) return {status:'waiting'};
    await client.query('UPDATE vinyl.mirror_state SET last_attempt_at=clock_timestamp() WHERE user_id=$1',[userId]);
    attempted=true;
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const generation=(await client.query('SELECT generation FROM vinyl.mirror_state WHERE user_id=$1',[userId])).rows[0].generation;
    const snapshot={};
    for(const section of ['collection','wishlist']) snapshot[section]=await recordRepository(client,userId,section).list();
    await client.query('COMMIT');
    const verification=snapshotReport(snapshot);
    for(const section of ['collection','wishlist']) {
      // Compare before writing to recover unknown outcomes without replaying commands.
      let current;
      await checkConnection();
      try {current=await adapter.read(section);} catch {current=null;}
      await checkConnection();
      if (stateHash(current)!==stateHash(snapshot[section])) await adapter.replace(section,snapshot[section]);
      await checkConnection();
      if (stateHash(await adapter.read(section))!==stateHash(snapshot[section])) throw Error('MIRROR_VERIFY_FAILED');
    }
    await client.query(`UPDATE vinyl.mirror_state SET synced_generation=$2,last_success_at=clock_timestamp(),
      next_attempt_at=clock_timestamp()+CASE WHEN generation=$2 THEN interval '1 hour' ELSE interval '0 seconds' END,
      dirty_since=CASE WHEN generation=$2 THEN NULL ELSE dirty_since END,last_error=NULL,failures=0,verification=$3 WHERE user_id=$1`,[userId,generation,verification]);
    return {status:'verified',generation,verification};
  } catch(error) {
    try {await client.query('ROLLBACK');} catch {broken=true;}
    if (attempted&&!broken) {
      const code=error.message==='MIRROR_VERIFY_FAILED'?'MIRROR_VERIFY_FAILED':'MIRROR_SYNC_FAILED';
      const seconds=Math.min(3600,5*2**Math.min((await mirrorStatus(client,userId)).failures,9))*(1+random()*0.2);
      await client.query(`UPDATE vinyl.mirror_state SET failures=failures+1,last_error=$2,
        next_attempt_at=clock_timestamp()+($3 * interval '1 second') WHERE user_id=$1`,[userId,code,seconds]);
      return {status:'failed',error:code};
    }
    throw Error('Mirror database unavailable');
  } finally {
    if(locked&&!broken)try{await client.query('SELECT pg_advisory_unlock($1)',[MIRROR_LOCK]);}catch{broken=true;}
    client.removeListener('error',disconnected);
    client.release(broken);
  }
}
