import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { OperationError } from '../record-operations.mjs';
import { insertUser } from '../postgres/users.mjs';
import { normalizeLogin, normalizeEmail, registrationInput } from './identity.mjs';
import { passwordHash, passwordMatches, validatePassword } from './passwords.mjs';
import { createResourceGate } from './resource-gate.mjs';
const MINUTE = 60000, DAY = 86400000;
export const digest = value => createHash('sha256').update(value).digest('hex');
export const randomToken = () => randomBytes(32).toString('hex');
const fail = (status, code) => { throw new OperationError(status, code); };
export async function transaction(pool, work) {
  const client = await pool.connect(); let broken = false;
  try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
  catch (error) { try { await client.query('ROLLBACK'); } catch { broken = true; } throw error; }
  finally { client.release(broken); }
}
export async function createAuthStore({ pool, secret, emailService, now = Date.now, registrationEnabled = false, ownerId, legacyEnabled = false, audit = () => {}, statistics = null }) {
  if (!/^[a-f0-9]{64}$/.test(secret || '')) throw Error('Separate 32-byte auth secret required');
  const authTransaction = work => transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock_shared(44160403)');
    return work(client);
  });
  async function quarantine(client,userId) {
    return (await client.query(`SELECT q.* FROM vinyl.restore_quarantine q
      JOIN vinyl.restore_epoch e ON e.restore_id=q.restore_id
      JOIN vinyl.user_auth a ON a.user_id=q.user_id
      WHERE q.user_id=$1 AND a.status='disabled' AND a.auth_version=q.auth_version`,[userId])).rows[0];
  }
  async function restoreGrant(client,flow) {
    const q=await quarantine(client,flow.user_id);
    const grant=(await client.query('SELECT * FROM vinyl.restore_recovery_grants WHERE flow_id=$1',[flow.id])).rows[0];
    if(!q || !grant || grant.user_id!==q.user_id || grant.restore_id!==q.restore_id || grant.consumed_at || grant.expires_at<=new Date(now()) || flow.auth_version!==q.auth_version)fail(400,'FLOW_EXPIRED');
    return grant;
  }
  const hmac = (scope, ...values) => createHmac('sha256', Buffer.from(secret, 'hex')).update(JSON.stringify([scope, ...values])).digest('hex');
  const mailGate = createResourceGate({ capacity: 4, timeoutMs: 10000 });
  const dummy = await passwordHash('Synthetic dummy password for timing');
  const sending = new Set(); let lastSend=0;
  const event=(name,subject)=>{try{audit({event:name,subject:subject?hmac('audit',subject):undefined});}catch{/* Logging must never alter a committed operation. */}};
  const purposeFor = kind => ['reset','restore'].includes(kind) ? 'PASSWORD_RESET' : 'EMAIL_VERIFICATION';
  const input = work => { try { return work(); } catch { fail(400, 'INVALID_INPUT'); } };
  const keyFor = email => hmac('subject', email);
  const csrfFor = tokenDigest => hmac('csrf-session', tokenDigest);
  async function rate(scope, subject, maximum, windowMs) {
    const time = now(), start = Math.floor(time / windowMs) * windowMs;
    const { rows } = await pool.query(`INSERT INTO vinyl.auth_rate_limits(scope,subject_key,window_start,counter,expires_at)
      VALUES($1,$2,$3,1,$4) ON CONFLICT(scope,subject_key,window_start)
      DO UPDATE SET counter=LEAST(vinyl.auth_rate_limits.counter+1,1000000) RETURNING counter`,
      [scope, hmac('rate', subject), start, new Date(start + windowMs)]);
    if (rows[0].counter > maximum) fail(429, 'RATE_LIMITED');
  }
  async function flowFor(client, token, lock = false) {
    if (!/^[a-f0-9]{64}$/.test(token || '')) fail(400, 'FLOW_EXPIRED');
    const row = (await client.query(`SELECT * FROM vinyl.auth_flows WHERE token_digest=$1 ${lock ? 'FOR UPDATE' : ''}`, [digest(token)])).rows[0];
    if (!row || ['completed','cancelled'].includes(row.state) || (row.state === 'verified' ? row.grant_expires_at : row.expires_at) <= new Date(now())) fail(400, 'FLOW_EXPIRED');
    return row;
  }
  async function issue(client, flow) {
    const purpose = purposeFor(flow.kind), time = now();
    // Same lock for start/resend across devices; row absence cannot race a SELECT.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,44160404))', [flow.subject_key + purpose]);
    const previous = (await client.query('SELECT created_at FROM vinyl.auth_challenges WHERE subject_key=$1 AND purpose=$2 ORDER BY created_at DESC LIMIT 1', [flow.subject_key, purpose])).rows[0];
    if (previous && time - previous.created_at.getTime() < MINUTE) return null;
    await client.query('UPDATE vinyl.auth_challenges SET superseded_at=$3 WHERE subject_key=$1 AND purpose=$2 AND consumed_at IS NULL AND superseded_at IS NULL', [flow.subject_key, purpose, new Date(time)]);
    const id = randomUUID(), code = String(randomInt(1000000)).padStart(6, '0');
    await client.query(`INSERT INTO vinyl.auth_challenges(id,flow_id,subject_key,purpose,code_hmac,key_version,created_at,expires_at)
      VALUES($1,$2,$3,$4,$5,1,$6,$7)`, [id, flow.id, flow.subject_key, purpose, hmac('otp', 1, purpose, id, flow.subject_key, code), new Date(time), new Date(time + 10 * MINUTE)]);
    return { id, email: flow.email, code, purpose, eligible: flow.eligible };
  }
  function send(message) {
    if (!message) return;
    const pending = mailGate.run(async () => {
      let state = 'failed';
      if (message.eligible) {
        try {
          const wait=(emailService.minIntervalMs || 0)-(Date.now()-lastSend);
          if(wait>0)await new Promise(resolve=>setTimeout(resolve,wait));
          lastSend=Date.now();
          state = await emailService.send({ email: message.email, code: message.code, purpose: message.purpose }); }
        catch { state = 'unknown'; }
      }
      if (!['accepted','failed','unknown'].includes(state)) state = 'unknown';
      await pool.query('UPDATE vinyl.auth_challenges SET send_state=$2 WHERE id=$1', [message.id, state]);
    }).catch(async () => {
      await pool.query("UPDATE vinyl.auth_challenges SET send_state='unknown' WHERE id=$1", [message.id]).catch(() => {});
    });
    sending.add(pending); pending.finally(() => sending.delete(pending));
  }
  async function mailAvailable() {
    if(emailService.check && !await emailService.check())fail(503,'MAIL_UNAVAILABLE');
  }
  async function emailLimits(email, purpose) {
    await rate('email-hour-' + purpose, email, 3, 60 * MINUTE);
    await rate('email-day', email, 10, DAY);
    if(purpose==='EMAIL_VERIFICATION')await rate('verification-global-day','all',140,DAY);
    await rate('email-global-day', 'all', 180, DAY);
  }
  return {
    hmac, csrfFor, rate,
    async flushMail() { await Promise.all([...sending]); },
    async cleanup() {
      await pool.query(`DELETE FROM vinyl.auth_flows WHERE id IN (SELECT id FROM vinyl.auth_flows WHERE expires_at < clock_timestamp()-interval '1 day' LIMIT 500)`);
      await pool.query(`DELETE FROM vinyl.auth_sessions WHERE token_digest IN (SELECT token_digest FROM vinyl.auth_sessions WHERE expires_at < clock_timestamp() OR revoked_at IS NOT NULL LIMIT 500)`);
      await pool.query(`DELETE FROM vinyl.auth_rate_limits WHERE ctid IN (SELECT ctid FROM vinyl.auth_rate_limits WHERE expires_at < clock_timestamp() LIMIT 500)`);
    },
    async start(kind, body, ip, ownerSession) {
      if (!['registration','reset','owner'].includes(kind)) fail(404, 'NOT_FOUND');
      if (kind === 'registration' && !registrationEnabled) fail(403, 'REGISTRATION_DISABLED');
      await rate('start-' + kind, ip, 10, 15 * MINUTE);
      await mailAvailable();
      let data, user;
      if (kind === 'owner') {
        if (!legacyEnabled || !ownerSession?.legacy || ownerSession.userId !== ownerId) fail(403, 'FORBIDDEN');
        user = (await pool.query('SELECT * FROM vinyl.users WHERE id=$1', [ownerId])).rows[0];
        if (!user || (await pool.query('SELECT user_id FROM vinyl.user_auth WHERE user_id=$1', [ownerId])).rowCount) fail(409, 'ALREADY_ACTIVATED');
        data = { email: user.email, emailNormalized: user.email_normalized };
      } else data = input(() => kind === 'registration' ? registrationInput(body) : normalizeEmail(body.email));
      if (kind === 'registration' && (await pool.query('SELECT login_normalized FROM vinyl.login_reservations WHERE login_normalized=$1', [data.login])).rowCount) fail(409, 'LOGIN_TAKEN');
      await emailLimits(data.emailNormalized, purposeFor(kind));
      const token = randomToken(), id = randomUUID(), time = now();
      const message = await authTransaction(async client => {
        if(kind==='owner' && (await client.query('SELECT 1 FROM vinyl.restore_epoch')).rowCount)fail(403,'FORBIDDEN');
        const account = (await client.query('SELECT u.id,a.status,a.auth_version FROM vinyl.users u LEFT JOIN vinyl.user_auth a ON a.user_id=u.id WHERE u.email_normalized=$1', [data.emailNormalized])).rows[0];
        const q=kind==='reset' && account ? await quarantine(client,account.id) : null;
        if(q){kind='restore';data={...data,email:q.email,emailNormalized:q.email_normalized};}
        const eligible = kind==='restore' || kind === 'owner' || (kind === 'registration' ? !account : account?.status === 'active' && !(legacyEnabled && account.id === ownerId));

        const flow = (await client.query(`INSERT INTO vinyl.auth_flows(id,token_digest,kind,user_id,email,email_normalized,login,full_name,subject_key,eligible,auth_version,created_at,expires_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [id,digest(token),kind,kind === 'registration' ? null : user?.id || account?.id || null,data.email,data.emailNormalized,data.login || null,data.fullName || null,keyFor(data.emailNormalized),Boolean(eligible),account?.auth_version || null,new Date(time),new Date(time+30*MINUTE)])).rows[0];
        if(q)await client.query('INSERT INTO vinyl.restore_recovery_grants(flow_id,user_id,restore_id,expires_at) VALUES($1,$2,$3,$4)',[flow.id,q.user_id,q.restore_id,new Date(time+30*MINUTE)]);
        return issue(client, flow);
      });
      send(message); event('auth_flow_started',data.emailNormalized); return { token, state: 'pending', resendAfter: 60 };
    },
    async resend(token, ip) {
      const initial = await flowFor(pool, token);
      await rate('resend-ip', ip, 10, 15*MINUTE);
      await mailAvailable();
      await emailLimits(initial.email_normalized, purposeFor(initial.kind));
      const message = await authTransaction(async client => {
        const flow = await flowFor(client, token, true);
        if(flow.kind==='restore')await restoreGrant(client,flow);
        if (flow.state !== 'pending') fail(400, 'INVALID_FLOW');
        return issue(client, flow);
      });
      send(message); return { state: 'pending', resendAfter: 60 };
    },
    async verify(token, code, ip) {
      await rate('verify-ip', ip, 30, 15*MINUTE);
      const next = randomToken();
      const result = await authTransaction(async client => {
        const flow = await flowFor(client, token, true);
        if(flow.kind==='restore')await restoreGrant(client,flow);
        if (flow.state !== 'pending') return false;
        const challenge = (await client.query(`SELECT * FROM vinyl.auth_challenges WHERE flow_id=$1 AND consumed_at IS NULL AND superseded_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [flow.id])).rows[0];
        if (!challenge || challenge.attempts >= 5 || challenge.expires_at <= new Date(now())) return false;
        const expected = hmac('otp',1,challenge.purpose,challenge.id,flow.subject_key,typeof code === 'string' ? code : 'invalid');
        const correct = /^[0-9]{6}$/.test(code || '') && flow.eligible && timingSafeEqual(Buffer.from(expected,'hex'), Buffer.from(challenge.code_hmac,'hex'));
        if (!correct) { await client.query('UPDATE vinyl.auth_challenges SET attempts=attempts+1 WHERE id=$1',[challenge.id]); return false; }
        await client.query('UPDATE vinyl.auth_challenges SET consumed_at=$2 WHERE id=$1',[challenge.id,new Date(now())]);
        await client.query("UPDATE vinyl.auth_flows SET state='verified',verified_at=$2,grant_expires_at=$3,token_digest=$4 WHERE id=$1",[flow.id,new Date(now()),new Date(now()+15*MINUTE),digest(next)]);
        if(flow.kind==='restore')await client.query('UPDATE vinyl.restore_recovery_grants SET expires_at=$2 WHERE flow_id=$1',[flow.id,new Date(now()+15*MINUTE)]);
        return true;
      });
      if (!result) {event('verification_failed');fail(400,'INVALID_CODE');}
      event('verification_succeeded');
      return { token: next, state: 'verified' };
    },
    async complete(token, body, ip) {
      await rate('complete-ip',ip,10,15*MINUTE);
      const initial = await flowFor(pool,token);
      await rate('complete-flow',initial.id,5,30*MINUTE);
      if (initial.state !== 'verified') fail(400,'INVALID_FLOW');
      try{validatePassword(body.password,body.repeat);}catch(error){fail(400,['INVALID_PASSWORD','PASSWORD_MISMATCH','COMMON_PASSWORD'].includes(error.message)?error.message:'INVALID_PASSWORD');}
      if (typeof body.repeat !== 'string') fail(400,'PASSWORD_MISMATCH');
      if(initial.kind==='restore'){
        const old=(await pool.query('SELECT password_hash FROM vinyl.user_auth WHERE user_id=$1',[initial.user_id])).rows[0];
        if(old && await passwordMatches(body.password,old.password_hash))fail(400,'INVALID_PASSWORD');
      }
      const hash = await passwordHash(body.password);
      try { const completed=await authTransaction(async client => {
        // Existing-user paths always acquire the user lock BEFORE flow/auth rows.
        if (initial.user_id) await client.query('SELECT id FROM vinyl.users WHERE id=$1 FOR UPDATE',[initial.user_id]);
        const flow = await flowFor(client,token,true);
        if(flow.state!=='verified' || !flow.eligible) fail(400,'INVALID_FLOW');
        let userId = flow.user_id;
        if(flow.kind==='registration') {
          const login = input(() => normalizeLogin(body.login ?? flow.login));
          const u = await insertUser(client,{login,email:flow.email,fullName:flow.full_name}); userId=u.id;
          await client.query("INSERT INTO vinyl.user_auth(user_id,status,password_hash,email_verified_at) VALUES($1,'active',$2,$3)",[userId,hash,flow.verified_at]);
          await statistics?.count(client,'registrations');
        } else if(flow.kind==='owner') {
          if(!legacyEnabled || userId!==ownerId) fail(403,'FORBIDDEN');
          await client.query("INSERT INTO vinyl.user_auth(user_id,status,password_hash,email_verified_at) VALUES($1,'active',$2,$3)",[userId,hash,flow.verified_at]);
        } else if(flow.kind==='restore') {
          const grant=await restoreGrant(client,flow);
          await client.query("UPDATE vinyl.user_auth SET status='active',password_hash=$2,auth_version=auth_version+1,password_changed_at=$3 WHERE user_id=$1",[userId,hash,new Date(now())]);
          await client.query('DELETE FROM vinyl.auth_sessions WHERE user_id=$1',[userId]);
          await client.query('UPDATE vinyl.users SET collection_public=false,wishlist_public=false WHERE id=$1',[userId]);
          await client.query('UPDATE vinyl.restore_recovery_grants SET consumed_at=$2 WHERE flow_id=$1',[grant.flow_id,new Date(now())]);
          await client.query("UPDATE vinyl.auth_flows SET state='cancelled' WHERE user_id=$1 AND id<>$2 AND state IN ('pending','verified')",[userId,flow.id]);
        } else {
          const updated = await client.query(`UPDATE vinyl.user_auth SET password_hash=$2,auth_version=auth_version+1,password_changed_at=$3
            WHERE user_id=$1 AND status='active' AND auth_version=$4 RETURNING user_id`,[userId,hash,new Date(now()),flow.auth_version]);
          if(!updated.rowCount || (legacyEnabled&&userId===ownerId)) fail(400,'INVALID_FLOW');
          await client.query('UPDATE vinyl.auth_sessions SET revoked_at=$2 WHERE user_id=$1 AND revoked_at IS NULL',[userId,new Date(now())]);
          await client.query("UPDATE vinyl.auth_flows SET state='cancelled' WHERE user_id=$1 AND kind='reset' AND id<>$2 AND state IN ('pending','verified')",[userId,flow.id]);
        }
        await client.query("UPDATE vinyl.auth_flows SET state='completed',completed_at=$2 WHERE id=$1",[flow.id,new Date(now())]);
        return { state:'completed' };
      }); event(initial.kind==='reset'?'password_reset_completed':'account_activated',initial.email_normalized);return completed; } catch(error) {
        if(error.code==='23505') {
          if(error.constraint?.includes('login')) fail(409,'LOGIN_TAKEN');
          fail(400,'REGISTRATION_UNAVAILABLE');
        }
        throw error;
      }
    },
    async login(body, ip, previousToken) {
      await rate('login-ip',ip,20,15*MINUTE);
      let login; try { login=normalizeLogin(body.login); } catch { login=null; }
      const loginWindow=Math.floor(now()/(15*MINUTE))*(15*MINUTE);
      await rate('login-name',login || 'invalid',5,15*MINUTE);
      const row=(await pool.query('SELECT a.*,u.login FROM vinyl.user_auth a JOIN vinyl.users u ON u.id=a.user_id WHERE u.login_normalized=$1',[login])).rows[0];
      const matches=await passwordMatches(body.password,row?.password_hash || dummy);
      if(!matches || !row || row.status!=='active') {event('login_failed',login);fail(401,'INVALID_CREDENTIALS');}
      const token=randomToken(),time=now();
      const session=await authTransaction(async client=>{
        await client.query('SELECT id FROM vinyl.users WHERE id=$1 FOR UPDATE',[row.user_id]);
        const current=(await client.query('SELECT * FROM vinyl.user_auth WHERE user_id=$1 FOR UPDATE',[row.user_id])).rows[0];
        if(!current || current.status!=='active' || current.auth_version!==row.auth_version || current.password_hash!==row.password_hash) fail(401,'INVALID_CREDENTIALS');
        if(previousToken) await client.query('UPDATE vinyl.auth_sessions SET revoked_at=$2 WHERE token_digest=$1',[digest(previousToken),new Date(time)]);
        await client.query(`UPDATE vinyl.auth_sessions SET revoked_at=$2 WHERE token_digest IN
          (SELECT token_digest FROM vinyl.auth_sessions WHERE user_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC OFFSET 9)`,[row.user_id,new Date(time)]);
        await client.query('INSERT INTO vinyl.auth_sessions(token_digest,user_id,auth_version,created_at,last_seen_at,expires_at) VALUES($1,$2,$3,$4,$4,$5)',[digest(token),row.user_id,row.auth_version,new Date(time),new Date(time+7*DAY)]);
        // Admission reserves an attempt before KDF; successful login releases it.
        // Failed attempts stay persistent, and concurrent requests cannot oversubscribe.
        const bucket=[hmac('rate',login),loginWindow];
        const removed=await client.query("DELETE FROM vinyl.auth_rate_limits WHERE scope='login-name' AND subject_key=$1 AND window_start=$2 AND counter=1",bucket);
        if(!removed.rowCount)await client.query("UPDATE vinyl.auth_rate_limits SET counter=counter-1 WHERE scope='login-name' AND subject_key=$1 AND window_start=$2 AND counter>1",bucket);
        return {userId:row.user_id,login:row.login,csrf:csrfFor(digest(token)),expiresAt:time+7*DAY};
      });
      event('login_succeeded',row.user_id);return {token,session};
    },
    async session(token) {
      if(!/^[a-f0-9]{64}$/.test(token || '')) return null;
      const {rows}=await pool.query(`SELECT s.*,u.login FROM vinyl.auth_sessions s JOIN vinyl.user_auth a ON a.user_id=s.user_id JOIN vinyl.users u ON u.id=s.user_id
        WHERE s.token_digest=$1 AND s.revoked_at IS NULL AND s.expires_at>$2 AND s.last_seen_at>$3 AND a.status='active' AND a.auth_version=s.auth_version`,[digest(token),new Date(now()),new Date(now()-DAY)]);
      const s=rows[0];if(!s)return null;
      if(now()-s.last_seen_at.getTime()>MINUTE) await pool.query('UPDATE vinyl.auth_sessions SET last_seen_at=GREATEST(last_seen_at,$2) WHERE token_digest=$1',[digest(token),new Date(now())]);
      return {tokenDigest:s.token_digest,authVersion:s.auth_version,userId:s.user_id,login:s.login,csrf:csrfFor(s.token_digest),expiresAt:s.expires_at.getTime()};
    },
    async logout(token) { if(token) await pool.query('UPDATE vinyl.auth_sessions SET revoked_at=$2 WHERE token_digest=$1',[digest(token),new Date(now())]);event('session_revoked'); }
  };
}
