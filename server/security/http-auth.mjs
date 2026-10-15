import { validateAuthStartup } from './startup-policy.mjs';
import { createDeletionSafety } from './deletion-safety.mjs';
import { createAccountStore } from './account-store.mjs';
import { timingSafeEqual } from 'node:crypto';
import { clientIP, createAuth, createLimiter, createReportLimiter } from '../auth.mjs';
import { OperationError } from '../record-operations.mjs';
import { createAuthStore, randomToken } from './auth-store.mjs';
import { createEmailService } from './email.mjs';
const deny = () => { throw new OperationError(403,'FORBIDDEN'); };
const equal = (a,b) => typeof a==='string' && typeof b==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
function cookieValue(req,name) {
  const values=(req.headers.cookie || '').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name+'='));
  return values.length===1 ? values[0].slice(name.length+1) : null;
}
export async function createMultiUserAuth({pool,env,ownerId,emailService,covers,ledger,statistics=null,now=Date.now}) {
  const production=env.NODE_ENV==='production',origin=env.APP_ORIGIN;
  let url;try{url=new URL(origin);}catch{throw Error('Explicit APP_ORIGIN required');}
  if(url.origin!==origin || (production ? url.protocol!=='https:' : !['http://127.0.0.1','http://localhost'].includes(`${url.protocol}//${url.hostname}`)))throw Error('Unsafe auth origin');
  const mail=emailService || createEmailService(env);
  validateAuthStartup(env,{ledger,mail});
  const safety=ledger ? createDeletionSafety({pool,ledger,ownerId}) : null;
  if(safety)await safety.ready();
  if(production && !await mail.check())throw Error('SMTP unavailable at startup');
  const registrationEnabled=env.AUTH_REGISTRATION_ENABLED==='true',legacyEnabled=env.AUTH_LEGACY_ENABLED==='true';
  const legacy=legacyEnabled ? createAuth({passwordHash:env.OWNER_PASSWORD_HASH,origin,production,now}) : null;
  const store=await createAuthStore({pool,secret:env.AUTH_SECRET,emailService:mail,ownerId,legacyEnabled,registrationEnabled,now,statistics,audit:event=>console.info(JSON.stringify(event))});
  const name=production?'__Host-vinyl_auth':'vinyl_auth',flowName=production?'__Host-vinyl_flow':'vinyl_flow',preName=production?'__Host-vinyl_pre':'vinyl_pre';
  const ip=req=>{
    const value=clientIP(req,production);
    if(!value.includes(':'))return value;
    const [left,right='']=value.split('::'),a=left?left.split(':'):[],b=right?right.split(':'):[];
    const words=value.includes('::')?[...a,...Array(8-a.length-b.length).fill('0'),...b]:a;
    return words.slice(0,4).map(x=>parseInt(x,16).toString(16)).join(':')+'::/64';
  };
  const readLimiter=createLimiter({limit:60,total:300,windowMs:60000,now});
  const reportLimiter=createReportLimiter({now});
  const streamingLimiter=createLimiter({limit:10,total:100,windowMs:60000,now});
  const cookie=(key,value,seconds)=>`${key}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${production?'; Secure':''}`;
  const setCookie=(res,key,value,seconds)=>res.setHeader('Set-Cookie',[...(res.getHeader('Set-Cookie') || []),cookie(key,value,seconds)]);
  function checkOrigin(req) {if(req.headers.host!==url.host || req.headers.origin!==origin || req.headers['sec-fetch-site']==='cross-site')deny();}
  function preauth(req) {
    const token=cookieValue(req,preName),parts=token?.split('.');
    if(parts?.length!==3 || !/^[a-f0-9]{64}$/.test(parts[0]) || !/^\d{13}$/.test(parts[1]) || Number(parts[1])<now() || !equal(parts[2],store.hmac('precsrf',parts[0],parts[1])) || !equal(req.headers['x-csrf-token'],token))deny();
  }
  const describe=s=>s?{role:'owner',userId:s.userId,login:s.login,csrfToken:s.csrf,expiresAt:s.expiresAt,authMode:'multiuser',legacy:Boolean(s.legacy)}:{role:'guest',authMode:'multiuser'};
  const accounts=createAccountStore({pool,store,ownerId,covers,legacyEnabled,ledger,now});
  async function safeReturn(req,session) {
    if(session)return `/${session.login}/collection`;
    const candidate=new URL(req.url,origin).searchParams.get('returnTo') || '/';
    const match=candidate.match(/^\/([a-zA-Z][a-zA-Z0-9_-]{2,29})\/(collection|wishlist)$/);
    if(!match)return '/';
    const column=match[2]==='collection'?'collection_public':'wishlist_public';
    const user=(await pool.query(`SELECT login FROM vinyl.users WHERE login_normalized=$1 AND ${column}`,[match[1].toLowerCase()])).rows[0];
    return user ? `/${user.login}/${match[2]}` : '/';
  }
  const api={store,accounts,describe,ready:()=>safety?.ready(),
    async session(req) {
      const newCookie=cookieValue(req,name),legacySession=legacy?.session(req);
      if(newCookie && legacySession)deny();
      if(newCookie)return store.session(newCookie);
      if(legacySession){const user=(await pool.query('SELECT login FROM vinyl.users WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM vinyl.restore_epoch)',[ownerId])).rows[0];if(!user)return null;return {...legacySession,userId:ownerId,login:user.login,legacy:true,expiresAt:legacySession.created+7*86400000};}
      return null;
    },checkOrigin,
    requireOwner(req,s){if(!s)throw new OperationError(401,'AUTH_REQUIRED');if(!equal(req.headers['x-csrf-token'],s.csrf))deny();},
    limit(req,kind,res){const retry=(kind==='report'?reportLimiter:kind==='streaming'?streamingLimiter:readLimiter)(ip(req));if(retry){res.setHeader('Retry-After',retry);throw new OperationError(429,'RATE_LIMITED');}},
    async handle(req,res,path,body,session){
      if(!path.startsWith('/api/auth/'))return false;
      const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));return true;};
      if(path==='/api/auth/account'&&req.method==='GET')return reply(200,await accounts.get(session));
      if(path==='/api/auth/session'&&req.method==='GET'){if(!session)api.limit(req,'read',res);return reply(200,describe(session));}
      if(path==='/api/auth/bootstrap'&&req.method==='GET'){
        if(req.headers.host!==url.host || req.headers['sec-fetch-site']==='cross-site')deny();
        await store.rate('bootstrap',ip(req),30,900000);
        const nonce=randomToken(),expires=String(now()+30*60000),token=`${nonce}.${expires}.${store.hmac('precsrf',nonce,expires)}`;
        setCookie(res,preName,token,1800);
        return reply(200,{csrfToken:token,registrationEnabled,legacyEnabled,session:describe(session),returnTo:await safeReturn(req,session)});
      }
      const allowed=new Set(['login','legacy-login','logout','registration','forgot','owner-activate','resend','verify','complete','settings','change-password','delete-account']);
      const action=path.slice('/api/auth/'.length);
      if(!allowed.has(action))return reply(404,{error:'NOT_FOUND'});
      if(req.method!=='POST'){res.setHeader('Allow','POST');return reply(405,{error:'METHOD_NOT_ALLOWED'});}
      checkOrigin(req);
      if(['logout','owner-activate','settings','change-password','delete-account'].includes(action))api.requireOwner(req,session);else preauth(req);
      if(!body || typeof body!=='object' || Array.isArray(body))throw new OperationError(400,'INVALID_REQUEST');
      if(action==='settings')return reply(200,await accounts.settings(session,body));
      if(action==='change-password'){const result=await accounts.changePassword(session,body,ip(req));setCookie(res,name,result.token,7*86400);setCookie(res,flowName,'',0);return reply(200,describe(result.session));}
      if(action==='delete-account'){const result=await accounts.remove(session,body,ip(req));setCookie(res,name,'',0);setCookie(res,flowName,'',0);return reply(200,result);}
      if(action==='login'){
        const result=await store.login(body,ip(req),cookieValue(req,name));
        if(legacy)legacy.logout(req,{setHeader(){}});
        setCookie(res,production?'__Host-vinyl_session':'vinyl_session','',0);
        setCookie(res,name,result.token,604800);setCookie(res,flowName,'',0);
        return reply(200,describe(result.session));
      }
      if(action==='legacy-login'){
        if(!legacy || (await pool.query('SELECT 1 FROM vinyl.restore_epoch')).rowCount)deny();legacy.limit(req,'login',res);
        const result=await legacy.login(req,res,body);
        // Legacy writes its own cookie header; append the new-cookie clear afterwards.
        const old=res.getHeader('Set-Cookie');res.setHeader('Set-Cookie',Array.isArray(old)?old:[old]);
        setCookie(res,name,'',0);return reply(200,{...result,authMode:'multiuser'});
      }
      if(action==='logout'){
        if(session.legacy){legacy.logout(req,res);const old=res.getHeader('Set-Cookie');res.setHeader('Set-Cookie',Array.isArray(old)?old:[old]);}
        else await store.logout(cookieValue(req,name));
        setCookie(res,name,'',0);return reply(200,{role:'guest',authMode:'multiuser'});
      }
      if(['registration','forgot','owner-activate'].includes(action)){
        const result=await store.start(action==='registration'?'registration':action==='forgot'?'reset':'owner',body,ip(req),session);
        setCookie(res,flowName,result.token,1800);return reply(202,{state:result.state,resendAfter:result.resendAfter});
      }
      const flow=cookieValue(req,flowName);
      if(action==='resend')return reply(202,await store.resend(flow,ip(req)));
      if(action==='verify'){const result=await store.verify(flow,body.code,ip(req));setCookie(res,flowName,result.token,900);return reply(200,{state:result.state});}
      const result=await store.complete(flow,body,ip(req));setCookie(res,flowName,'',0);return reply(200,result);
    }
  };
  return api;
}
