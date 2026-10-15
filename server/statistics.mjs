import { transaction } from './security/auth-store.mjs';
import { normalizeEmail } from './security/identity.mjs';
import { OperationError } from './record-operations.mjs';
export const moscowDay = value => new Date(new Date(value).getTime()+3*3600000).toISOString().slice(0,10);
export function dayBounds(day) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day||''))throw Error('Invalid statistics date');
 const start=new Date(day+'T00:00:00+03:00');
 if(moscowDay(start)!==day)throw Error('Invalid statistics date');
 return {start,end:new Date(start.getTime()+86400000)};
}
export const previousMoscowDay = value => moscowDay(new Date(value).getTime()-86400000);
export function statisticsConfiguration(env) {
 if(![undefined,'false','true'].includes(env.STATISTICS_ENABLED))throw Error('Invalid statistics flag');
 if(env.STATISTICS_ENABLED!=='true')return null;
 if(env.DATA_BACKEND!=='postgres'||env.AUTH_MODE!=='multiuser')throw Error('Statistics requires multiuser PostgreSQL');
 return {recipient:normalizeEmail(env.STATISTICS_EMAIL_TO).emailNormalized};
}
export function createStatistics(pool,{now=Date.now}={}) {
 const time=()=>new Date(now());
 async function initialize() {await pool.query('INSERT INTO vinyl.statistics_state(singleton,started_at) VALUES(true,$1) ON CONFLICT DO NOTHING',[time()]);}
 async function count(client,metric) {
  if(!['registrations','collection_added','wishlist_added'].includes(metric))throw Error('Invalid statistics metric');
  await client.query(`INSERT INTO vinyl.statistics_daily(day,${metric}) SELECT $1,1 FROM vinyl.statistics_state WHERE singleton
   ON CONFLICT(day) DO UPDATE SET ${metric}=vinyl.statistics_daily.${metric}+1`,[moscowDay(time())]);
 }
 async function view(session) {
  if(!session?.userId)return;
  await transaction(pool,async client=>{
   await client.query('SELECT pg_advisory_xact_lock_shared(44160403)');
   if((await client.query('SELECT frozen FROM vinyl.runtime_control WHERE singleton')).rows[0]?.frozen)throw new OperationError(503,'WRITES_FROZEN');
   // Lock the actor, never the profile being viewed. Serializes with deletion.
   if(!(await client.query('SELECT id FROM vinyl.users WHERE id=$1 FOR UPDATE',[session.userId])).rowCount)throw new OperationError(401,'AUTH_REQUIRED');
   if(!session.legacy && !(await client.query(`SELECT s.user_id FROM vinyl.auth_sessions s JOIN vinyl.user_auth a ON a.user_id=s.user_id
    WHERE s.token_digest=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
    AND s.last_seen_at>clock_timestamp()-interval '1 day' AND a.status='active' AND a.auth_version=s.auth_version`,[session.tokenDigest,session.userId])).rowCount)throw new OperationError(401,'AUTH_REQUIRED');
   const day=moscowDay(time());
   const added=await client.query(`INSERT INTO vinyl.statistics_user_days(user_id,day) SELECT $1,$2 FROM vinyl.statistics_state WHERE singleton ON CONFLICT DO NOTHING RETURNING user_id`,[session.userId,day]);
   if(added.rowCount)await client.query(`INSERT INTO vinyl.statistics_daily(day,active_users) VALUES($1,1) ON CONFLICT(day) DO UPDATE SET active_users=vinyl.statistics_daily.active_users+1`,[day]);
  });
 }
 return {initialize,count,view};
}
export function createStatisticsReporter(pool,{mail,recipient,now=Date.now}={}) {
 recipient=normalizeEmail(recipient).emailNormalized;
 async function run() {
  const client=await pool.connect();let locked=false,maintenance=false,broken=false;
  try {
   locked=(await client.query('SELECT pg_try_advisory_lock(44160411) AS ok')).rows[0].ok;
   if(!locked)return {state:'busy'};
   maintenance=(await client.query('SELECT pg_try_advisory_lock_shared(44160403) AS ok')).rows[0].ok;
   if(!maintenance || (await client.query('SELECT frozen FROM vinyl.runtime_control WHERE singleton')).rows[0]?.frozen)return {state:'deferred'};
   // A prior process may have sent before dying: never replay an ambiguous send.
   await client.query("UPDATE vinyl.statistics_reports SET state='unknown',last_error='DELIVERY_UNKNOWN',updated_at=$1 WHERE state='sending'",[new Date(now())]);
   const started=(await client.query('SELECT started_at FROM vinyl.statistics_state WHERE singleton')).rows[0]?.started_at;
   if(!started)return {state:'not-started'};
   const last=previousMoscowDay(now()),first=moscowDay(started);
   // One repeatable snapshot; past-day event counts survive user/record deletion.
   await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
   try {
    const totals=(await client.query(`SELECT (SELECT count(*) FROM vinyl.users) AS accounts,
     (SELECT count(*) FROM vinyl.user_auth WHERE email_verified_at IS NOT NULL) AS confirmed_accounts,
     (SELECT count(*) FROM vinyl.users u WHERE EXISTS(SELECT 1 FROM vinyl.collection_records r WHERE r.user_id=u.id)) AS nonempty_collections`)).rows[0];
    const days=(await client.query(`SELECT to_char(d,'YYYY-MM-DD') AS day FROM generate_series($1::date,$2::date,interval '1 day') d WHERE NOT EXISTS(SELECT 1 FROM vinyl.statistics_reports r WHERE r.day=d::date)`,[first,last])).rows;
    for(const {day} of days){
     const {start,end}=dayBounds(day),counts=(await client.query('SELECT registrations,collection_added,wishlist_added,active_users FROM vinyl.statistics_daily WHERE day=$1',[day])).rows[0]||{};
     const reports=(await client.query('SELECT count(*) AS count FROM vinyl.bug_report_deliveries WHERE created_at >= $1 AND created_at < $2 AND created_at >= $3',[start,end,started])).rows[0].count;
     const payload={day,start:start.toISOString(),end:end.toISOString(),trackingStartedAt:started.toISOString(),partial:started>start,snapshotAt:new Date(now()).toISOString(),
      ...Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,Number(v)])),...Object.fromEntries(['registrations','collection_added','wishlist_added','active_users'].map(k=>[k,Number(counts[k]||0)])),bug_reports:Number(reports)};
     await client.query('INSERT INTO vinyl.statistics_reports(day,payload,recipient,next_attempt_at,updated_at) VALUES($1,$2,$3,$4,$4) ON CONFLICT DO NOTHING',[day,payload,recipient,new Date(now())]);
    }
    // Only short-lived dedup identities are retained; aggregate counts remain.
    await client.query("DELETE FROM vinyl.statistics_user_days WHERE day < ($1::date-1)",[moscowDay(now())]);
    await client.query('COMMIT');
   }catch(error){await client.query('ROLLBACK');throw error;}
   const row=(await client.query(`SELECT *,to_char(day,'YYYY-MM-DD') AS report_day FROM vinyl.statistics_reports WHERE state='pending' AND next_attempt_at <= $1 AND attempts<3 ORDER BY day LIMIT 1`,[new Date(now())])).rows[0];
   if(!row){
    const unresolved=(await client.query("SELECT count(*) FILTER(WHERE state='unknown') AS unknown,count(*) FILTER(WHERE state='failed') AS failed,count(*) FILTER(WHERE state='pending') AS pending FROM vinyl.statistics_reports")).rows[0];
    return {state:Number(unresolved.unknown)+Number(unresolved.failed)>0?'attention':'idle',...Object.fromEntries(Object.entries(unresolved).map(([k,v])=>[k,Number(v)]))};
   }
   await client.query("UPDATE vinyl.statistics_reports SET state='sending',attempts=attempts+1,updated_at=$2 WHERE day=$1",[row.report_day,new Date(now())]);
   let result='unknown';try{result=await mail.sendStatistics({recipient:row.recipient,payload:row.payload});}catch{/* provider details never reach logs */}
   const attempt=row.attempts+1,state=result==='accepted'?'sent':result==='failed'?(attempt<3?'pending':'failed'):'unknown';
   const code=result==='accepted'?null:result==='failed'?(attempt<3?'SMTP_REJECTED':'ATTEMPTS_EXHAUSTED'):'DELIVERY_UNKNOWN';
   await client.query(`UPDATE vinyl.statistics_reports SET state=$2,last_error=$3,next_attempt_at=$4,updated_at=$5 WHERE day=$1`,[row.report_day,state,code,new Date(now()+2*60000),new Date(now())]);
   return {day:row.report_day,state,attempt,lastError:code};
  }finally{
   if(maintenance)try{await client.query('SELECT pg_advisory_unlock_shared(44160403)');}catch{broken=true;}
   if(locked)try{await client.query('SELECT pg_advisory_unlock(44160411)');}catch{broken=true;}
   client.release(broken);
  }
 }
 return {run};
}
export function statisticsMessage({recipient,payload:p}) {
 const {day}=p;dayBounds(day);
 for(const key of ['accounts','registrations','confirmed_accounts','nonempty_collections','active_users','collection_added','wishlist_added','bug_reports'])if(!Number.isSafeInteger(p[key])||p[key]<0)throw Error('Invalid statistics count');
 return {from:'Vinyl Collection <no-reply@vinyl-collection.ru>',to:normalizeEmail(recipient).emailNormalized,
  subject:`Vinyl Collection: статистика за ${day}`,messageId:`<daily-statistics.${day}@vinyl-collection.ru>`,
  text:`Статистика за ${day}, 00:00–24:00 МСК (конец не включён).\n${p.partial?'Неполные сутки: учёт начат '+p.trackingStartedAt:'Полные сутки учёта.'}\nТекущие показатели на ${p.snapshotAt}:\nОбщее число аккаунтов: ${p.accounts}\nПодтверждённые аккаунты: ${p.confirmed_accounts}\nПользователи с непустой Collection: ${p.nonempty_collections}\n\nЗа отчётные сутки:\nНовые регистрации: ${p.registrations}\nАктивные пользователи (успешный просмотр списка): ${p.active_users}\nДобавленные записи Collection: ${p.collection_added}\nДобавленные записи Wish-list: ${p.wishlist_added}\nНовые Bug Reports: ${p.bug_reports}\n\nУчёт событий начат: ${p.trackingStartedAt}. История до этого времени не восстанавливалась. Collection включает новые записи при переносе из Wish-list; существующая цель переноса повторно не считается.`};
}
