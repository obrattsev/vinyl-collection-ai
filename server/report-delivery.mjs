import { randomUUID } from 'node:crypto';
import { UUID } from '../src/base-record.mjs';
import { validReport } from '../src/bug-report.mjs';
import { OperationError } from './record-operations.mjs';
import { transaction } from './security/auth-store.mjs';
import { normalizeEmail } from './security/identity.mjs';

export function reportNotificationConfiguration(env) {
  if (!['true','false',undefined].includes(env.BUG_REPORT_NOTIFICATIONS_ENABLED)) throw Error('Invalid report notification flag');
  if (env.BUG_REPORT_NOTIFICATIONS_ENABLED !== 'true') return null;
  // Independent of From and SMTP credentials. No implicit owner/test-email fallback.
  return { recipient: normalizeEmail(env.BUG_REPORT_EMAIL_TO).emailNormalized };
}

export function reportPage(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > 160 ||
      !/^\/(?:collection|wishlist|[a-zA-Z][a-zA-Z0-9_-]{2,29}\/(?:collection|wishlist))\/?$/.test(value)) throw new OperationError(400,'INVALID_REPORT_PAGE');
  return value.replace(/\/$/,'');
}
function submission(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(k=>!['text','section','page'].includes(k)) || !validReport({text:input.text,section:input.section}) || input.text.includes('\0')) throw new OperationError(400,'INVALID_REPORT');
  return {text:input.text,section:input.section,page:reportPage(input.page)};
}
const sheetRecord = r => ({id:r.id,text:r.text,section:r.section,createdAt:r.created_at.toISOString(),version:r.version});
const sameSheet = (a,b) => ['id','text','section','createdAt','version'].every(k=>a[k]===b[k]);

export function createDurableReportService(pool,{repository,mail,recipient=null,version=null}={}) {
  if (!repository || (recipient && typeof mail?.sendReport !== 'function')) throw Error('Report delivery configuration required');
  async function create(input,{session,requestId}={}) {
    const data=submission(input);
    if (!session?.userId || !session.tokenDigest) throw new OperationError(401,'AUTH_REQUIRED');
    if (!UUID.test(requestId||'')) throw new OperationError(400,'REPORT_REQUEST_ID_REQUIRED');
    return transaction(pool,async client=>{
      await client.query('SELECT pg_advisory_xact_lock_shared(44160403)');
      if ((await client.query('SELECT frozen FROM vinyl.runtime_control WHERE singleton')).rows[0]?.frozen) throw new OperationError(503,'WRITES_FROZEN');
      const valid=await client.query(`SELECT s.user_id FROM vinyl.auth_sessions s JOIN vinyl.user_auth a ON a.user_id=s.user_id
        WHERE s.token_digest=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
        AND s.last_seen_at>clock_timestamp()-interval '1 day' AND a.status='active' AND a.auth_version=s.auth_version`,[session.tokenDigest,session.userId]);
      if (!valid.rowCount) throw new OperationError(401,'AUTH_REQUIRED');
      // Small global admission lock keeps persistent per-user/global counts atomic.
      await client.query('SELECT pg_advisory_xact_lock(44160410)');
      const previous=(await client.query('SELECT * FROM vinyl.bug_report_deliveries WHERE user_id=$1 AND request_id=$2',[session.userId,requestId])).rows[0];
      if (previous) {
        if (previous.text!==data.text || previous.section!==data.section || previous.page!==data.page) throw new OperationError(409,'REPORT_REQUEST_CONFLICT');
        return {id:previous.id};
      }
      const {rows:[counts]}=await client.query(`SELECT count(*) FILTER(WHERE user_id=$1 AND created_at>clock_timestamp()-interval '15 minutes') AS personal,
        count(*) AS total FROM vinyl.bug_report_deliveries WHERE created_at>clock_timestamp()-interval '1 hour'`,[session.userId]);
      if (Number(counts.personal)>=3 || Number(counts.total)>=50) throw new OperationError(429,'RATE_LIMITED',{retryAfter:Number(counts.total)>=50?3600:900});
      const id=randomUUID();
      await client.query(`INSERT INTO vinyl.bug_report_deliveries(id,user_id,request_id,text,section,page,version,mail_state)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,session.userId,requestId,data.text,data.section,data.page,version,recipient?'pending':'disabled']);
      // COMMIT happens before HTTP 201. Neither Sheets nor SMTP can undo acceptance.
      return {id};
    });
  }

  async function pump() {
    const client=await pool.connect();let locked=false,maintenance=false,broken=false;
    try {
      locked=(await client.query('SELECT pg_try_advisory_lock(44160408) AS ok')).rows[0].ok;
      if (!locked) return false;
      maintenance=(await client.query('SELECT pg_try_advisory_lock_shared(44160403) AS ok')).rows[0].ok;
      if (!maintenance || (await client.query('SELECT frozen FROM vinyl.runtime_control WHERE singleton')).rows[0]?.frozen) return false;
      const row=(await client.query(`SELECT r.* FROM vinyl.bug_report_deliveries r WHERE next_attempt_at<=clock_timestamp()
        AND ((sheet_state IN ('pending','writing','unknown') AND sheet_attempts<5) OR mail_state='sending' OR (mail_state='pending' AND $1::boolean))
        AND NOT EXISTS(SELECT 1 FROM vinyl.restore_quarantine q JOIN vinyl.user_auth a ON a.user_id=q.user_id
          WHERE q.user_id=r.user_id AND a.status='disabled') ORDER BY created_at,id LIMIT 1`,[Boolean(recipient)])).rows[0];
      if (!row) return false;
      await client.query("UPDATE vinyl.bug_report_deliveries SET next_attempt_at=clock_timestamp()+interval '1 minute' WHERE id=$1",[row.id]);
      if (['pending','writing','unknown'].includes(row.sheet_state) && row.sheet_attempts<5) {
        const expected=sheetRecord(row);
        await client.query('UPDATE vinyl.bug_report_deliveries SET sheet_attempts=sheet_attempts+1 WHERE id=$1',[row.id]);
        let state=row.sheet_state;
        try {
          const existing=(await repository.getRecords()).find(r=>r.id===row.id);
          if (existing) state=sameSheet(existing,expected)?'sent':'unknown';
          else if (state==='pending') {
            // Durable write intent precedes the external append. After any ambiguity,
            // subsequent runs may reconcile by ID but never blindly append again.
            await client.query("UPDATE vinyl.bug_report_deliveries SET sheet_state='writing' WHERE id=$1",[row.id]);
            state='unknown';
            try {await repository.appendRecord(expected);} catch { /* read-back below */ }
            const saved=(await repository.getRecords()).find(r=>r.id===row.id);
            if (saved && sameSheet(saved,expected)) state='sent';
          } else state='unknown';
        } catch { /* accepted PG report remains available; bounded retry/read-back */ }
        if(state==='pending' && row.sheet_attempts+1>=5)state='unknown';
        await client.query('UPDATE vinyl.bug_report_deliveries SET sheet_state=$2 WHERE id=$1',[row.id,state]);
      }
      if (row.mail_state==='sending') {
        // A previous process may have sent before losing its DB connection.
        await client.query("UPDATE vinyl.bug_report_deliveries SET mail_state='unknown' WHERE id=$1",[row.id]);
      } else if (row.mail_state==='pending' && recipient && row.mail_attempts<5) {
        await client.query("UPDATE vinyl.bug_report_deliveries SET mail_state='sending',mail_attempts=mail_attempts+1 WHERE id=$1",[row.id]);
        let result='unknown';
        try { result=await mail.sendReport({recipient,id:row.id,userId:row.user_id,createdAt:row.created_at.toISOString(),text:row.text,section:row.section,page:row.page}); } catch { /* sanitize all SMTP errors */ }
        const state=result==='accepted'?'sent':result==='failed'?(row.mail_attempts+1<5?'pending':'failed'):'unknown';
        await client.query('UPDATE vinyl.bug_report_deliveries SET mail_state=$2 WHERE id=$1',[row.id,state]);
      }
      return true;
    } finally {
      if (maintenance) try {await client.query('SELECT pg_advisory_unlock_shared(44160403)');} catch {broken=true;}
      if (locked) try {await client.query('SELECT pg_advisory_unlock(44160408)');} catch {broken=true;}
      client.release(broken);
    }
  }
  return {create,pump};
}

export function startReportDelivery(service,{interval=10000,onError=()=>{}}={}) {
  let active=null,closed=false;
  const tick=()=>{
    if (closed || active) return;
    active=service.pump().catch(()=>onError('REPORT_DELIVERY_UNAVAILABLE')).finally(()=>{active=null;});
  };
  const timer=setInterval(tick,interval);timer.unref();tick();
  return {async close(){closed=true;clearInterval(timer);await active;}};
}
