import { OperationError } from '../record-operations.mjs';
import { transaction, digest, randomToken } from './auth-store.mjs';
import { passwordMatches, passwordHash, validatePassword } from './passwords.mjs';
import { ownerTransaction } from '../postgres/repositories.mjs';
const fail=(status,code)=>{throw new OperationError(status,code);};
const exact=(body,keys)=>body && typeof body==='object' && !Array.isArray(body) && Object.keys(body).length===keys.length && keys.every(key=>Object.hasOwn(body,key));
export function createAccountStore({pool,store,ownerId,covers,ledger,legacyEnabled=false,now=Date.now}) {
  async function live(client,session) {
    if(!session)fail(401,'AUTH_REQUIRED');
    const user=(await client.query('SELECT * FROM vinyl.users WHERE id=$1 FOR UPDATE',[session.userId])).rows[0];
    if(!user)fail(401,'AUTH_REQUIRED');
    if(!session.legacy && !(await client.query(`SELECT s.user_id FROM vinyl.auth_sessions s JOIN vinyl.user_auth a ON a.user_id=s.user_id WHERE s.token_digest=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>$3 AND s.last_seen_at>$4 AND a.status='active' AND s.auth_version=a.auth_version`,[session.tokenDigest,session.userId,new Date(now()),new Date(now()-86400000)])).rowCount)fail(401,'AUTH_REQUIRED');
    return user;
  }
  async function verified(session,password,ip,action) {
    if(!session || session.legacy)fail(403,'ACTIVATION_REQUIRED');
    await store.rate('account-'+action+'-user',session.userId,5,15*60000);
    await store.rate('account-'+action+'-ip',ip,20,15*60000);
    const row=(await pool.query('SELECT * FROM vinyl.user_auth WHERE user_id=$1 AND status=\'active\'',[session.userId])).rows[0];
    if(!row || !await passwordMatches(password,row.password_hash))fail(401,'INVALID_CURRENT_PASSWORD');
    return row;
  }
  async function unchanged(client,session,old) {
    const user=await live(client,session);
    const row=(await client.query('SELECT * FROM vinyl.user_auth WHERE user_id=$1 FOR UPDATE',[session.userId])).rows[0];
    if(!row || row.auth_version!==old.auth_version || row.password_hash!==old.password_hash)fail(409,'AUTH_CHANGED');
    return user;
  }
  async function cleanup() {
    if(!covers)return;
    for(;;) {
      const removed=await transaction(pool,async client=>{
        await client.query('SELECT pg_advisory_xact_lock_shared(44160403)');
        if((await client.query('SELECT frozen FROM vinyl.runtime_control WHERE singleton')).rows[0]?.frozen)return false;
        const row=(await client.query('SELECT id FROM vinyl.cover_cleanup ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1')).rows[0];
        if(!row)return false;
        if((await client.query('SELECT id FROM vinyl.covers WHERE id=$1',[row.id])).rowCount)throw Error('Referenced cleanup cover');
        await covers.removeDeleted(row.id);
        await client.query('DELETE FROM vinyl.cover_cleanup WHERE id=$1',[row.id]);return true;
      });
      if(!removed)break;
    }
  }
  return {
    cleanup,
    async get(session) {
      return transaction(pool,async client=>{
        const u=await live(client,session);
        const mirror=(await client.query('SELECT user_id FROM vinyl.mirror_state WHERE user_id=$1',[u.id])).rowCount;
        return {login:u.login,email:u.email,publicCollection:u.collection_public&&u.wishlist_public,showSalePrice:u.show_sale_price,canChangePassword:!session.legacy&&!(legacyEnabled&&u.id===ownerId),canDelete:u.id!==ownerId&&!mirror&&!session.legacy,legacy:Boolean(session.legacy)};
      });
    },
    async settings(session,body) {
      if(!exact(body,['publicCollection','showSalePrice']) || typeof body.publicCollection!=='boolean' || typeof body.showSalePrice!=='boolean')fail(400,'INVALID_INPUT');
      await ownerTransaction(pool,session.userId,async client=>{
        await live(client,session);
        await client.query('UPDATE vinyl.users SET collection_public=$2,wishlist_public=$2,show_sale_price=$3,updated_at=clock_timestamp() WHERE id=$1',[session.userId,body.publicCollection,body.showSalePrice]);
      });
      return {state:'saved'};
    },
    async changePassword(session,body,ip) {
      if(!exact(body,['currentPassword','password','repeat']))fail(400,'INVALID_INPUT');
      if(legacyEnabled && session?.userId===ownerId)fail(403,'OWNER_BRIDGE_ACTIVE');
      const old=await verified(session,body.currentPassword,ip,'password');
      try{validatePassword(body.password,body.repeat);}catch(error){fail(400,error.message);}
      const hash=await passwordHash(body.password),token=randomToken(),time=now();
      const updated=await transaction(pool,async client=>{
        const user=await unchanged(client,session,old);
        const row=(await client.query('UPDATE vinyl.user_auth SET password_hash=$2,auth_version=auth_version+1,password_changed_at=$3 WHERE user_id=$1 RETURNING auth_version',[user.id,hash,new Date(time)])).rows[0];
        await client.query('UPDATE vinyl.auth_sessions SET revoked_at=$2 WHERE user_id=$1 AND revoked_at IS NULL',[user.id,new Date(time)]);
        await client.query("UPDATE vinyl.auth_flows SET state='cancelled' WHERE user_id=$1 AND state IN ('pending','verified')",[user.id]);
        await client.query('INSERT INTO vinyl.auth_sessions(token_digest,user_id,auth_version,created_at,last_seen_at,expires_at) VALUES($1,$2,$3,$4,$4,$5)',[digest(token),user.id,row.auth_version,new Date(time),new Date(time+7*86400000)]);
        return {userId:user.id,login:user.login,csrf:store.csrfFor(digest(token)),expiresAt:time+7*86400000};
      });
      return {token,session:updated};
    },
    async remove(session,body,ip) {
      if(!exact(body,['password','confirm']) || body.confirm!==true)fail(400,'CONFIRMATION_REQUIRED');
      if(session?.userId===ownerId)fail(403,'ACCOUNT_PROTECTED');
      const old=await verified(session,body.password,ip,'delete');
      await ownerTransaction(pool,session.userId,async client=>{
        const u=await unchanged(client,session,old);
        if((await client.query('SELECT user_id FROM vinyl.mirror_state WHERE user_id=$1',[u.id])).rowCount)fail(403,'ACCOUNT_PROTECTED');
        // The external tombstone is authoritative even if this SQL transaction rolls back.
        if(ledger)await ledger.append(u.id,u.login_normalized);
        await client.query('INSERT INTO vinyl.cover_cleanup(id,user_id,storage_key) SELECT id,user_id,storage_key FROM vinyl.covers WHERE user_id=$1',[u.id]);
        await client.query('DELETE FROM vinyl.collection_records WHERE user_id=$1',[u.id]);
        await client.query('DELETE FROM vinyl.wishlist_records WHERE user_id=$1',[u.id]);
        await client.query('DELETE FROM vinyl.covers WHERE user_id=$1',[u.id]);
        await client.query('DELETE FROM vinyl.auth_flows WHERE user_id=$1 OR email_normalized=$2',[u.id,u.email_normalized]);
        await client.query('DELETE FROM vinyl.users WHERE id=$1',[u.id]);
        // login_reservations intentionally survives forever. Mirror rows are never removed here.
      });
      let cleanupPending=false;
      try{await cleanup();cleanupPending=Boolean((await pool.query('SELECT 1 FROM vinyl.cover_cleanup WHERE user_id=$1 LIMIT 1',[session.userId])).rowCount);}catch{cleanupPending=true;}
      return {state:'deleted',cleanupPending};
    }
  };
}
