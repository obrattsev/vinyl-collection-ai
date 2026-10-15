// Operator-only, read-only verification. Never reloads nginx or changes a flag/service.
import http from 'node:http';
import https from 'node:https';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
const validToken=t=>typeof t==='string'&&/^[a-f0-9]{32}$/.test(t);
export const maintenanceChecks=Object.freeze([
 ['GET','/'],['HEAD','/auth'],['HEAD','/collection'],['HEAD','/wishlist'],
 ['HEAD','/api/collection'],['HEAD','/api/wishlist'],['HEAD','/api/auth/session'],
 // HEAD is deliberate: GET bootstrap writes a rate-limit row in the application.
 ['HEAD','/api/auth/bootstrap'],['HEAD','/api/auth/registration'],['HEAD','/api/auth/login'],
 ['HEAD','/api/bug-reports'],['HEAD','/api/collection/11111111-1111-4111-8111-111111111111/cover'],
 ['HEAD','/assets/auth-ui.mjs'],['HEAD','/media/covers/11111111-1111-4111-8111-111111111111/image.webp']
].map(Object.freeze));
export function maintenanceSnippet({flag,token}){
 if(!validToken(token)||typeof flag!=='string'||!/^\/[A-Za-z0-9_/.-]+$/.test(flag)||flag.split('/').includes('..'))throw Error('INVALID_MAINTENANCE_CONFIGURATION');
 // Include in EVERY public site server block, BEFORE any return/rewrite directive.
 // No public/operator IP exceptions. Read-only operator smoke uses the existing
 // private Node listener, without cookies or X-Collection-View.
 return `# Stage 4D operator template; install only with explicit production approval.\nopen_file_cache off;\nadd_header X-Vinyl-Gate-Config "${token}" always;\nif (-f ${flag}) { return 503; }\nerror_page 503 @vinyl_maintenance;\nlocation @vinyl_maintenance {\n    add_header X-Vinyl-Gate-Config "${token}" always;\n    add_header X-Vinyl-Maintenance "${token}" always;\n    add_header Cache-Control "no-store" always;\n    add_header Retry-After "60" always;\n    return 503 "Service temporarily unavailable\\n";\n}\n`;
}
export async function readProbe(url,{method='HEAD',timeout=3000}={}){
 if(!['GET','HEAD'].includes(method))throw Error('READ_ONLY_PROBE_REQUIRED');
 const u=new URL(url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('INVALID_PROBE_URL');
 return new Promise((resolve,reject)=>{
  if(!Number.isInteger(timeout)||timeout<1||timeout>10000)throw Error('INVALID_PROBE_TIMEOUT');
  const req=(u.protocol==='https:'?https:http).request(u,{method,agent:false,signal:AbortSignal.timeout(timeout),headers:{Connection:'close','Cache-Control':'no-cache, no-store'}},res=>{
   resolve({status:res.statusCode,headers:res.headers,peer:res.socket.remoteAddress});res.destroy();
  });
  req.setTimeout(timeout,()=>req.destroy(Error('PROBE_TIMEOUT')));req.on('error',()=>reject(Error('PROBE_UNAVAILABLE')));req.end();
 });
}
function origins(values){
 if(!Array.isArray(values)||!values.length||values.length>4)throw Error('INVALID_PROBE_ORIGINS');
 return values.map(value=>{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('INVALID_PROBE_ORIGIN');return u.origin;});
}
export async function captureMaintenanceBaseline({urls,request=readProbe}){
 const results=[];
 for(const origin of origins(urls))for(const[method,path]of maintenanceChecks){
  const r=await request(new URL(path,origin),{method});
  if(!Number.isInteger(r.status)||r.status<200||r.status>=500)throw Error('BASELINE_NOT_HEALTHY');
  results.push({origin,method,path,status:r.status,location:r.headers.location||null});
 }
 return results;
}
export async function checkMaintenanceArmed({baseline,token,request=readProbe}){
 if(!validToken(token)||!Array.isArray(baseline)||!baseline.length)throw Error('INVALID_ARMED_CHECK');
 const urls=[...new Set(baseline.map(b=>b.origin))];origins(urls);
 if(baseline.length!==urls.length*maintenanceChecks.length)throw Error('INCOMPLETE_BASELINE');
 for(const origin of urls)for(const[method,path]of maintenanceChecks){
  const expected=baseline.find(b=>b.origin===origin&&b.method===method&&b.path===path);if(!expected)throw Error('INCOMPLETE_BASELINE');
  const r=await request(new URL(path,origin),{method});
  if(r.status!==expected.status||(r.headers.location||null)!==expected.location||r.headers['x-vinyl-gate-config']!==token||r.headers['x-vinyl-maintenance'])throw Error('GATE_CONFIGURATION_NOT_READY');
 }
 return {armed:true};
}
export async function checkMaintenance({urls,token,rounds=3,request=readProbe}){
 const targets=origins(urls);if(!validToken(token)||!Number.isInteger(rounds)||rounds<3||rounds>5)throw Error('INVALID_MAINTENANCE_CHECK');
 const results=[];
 for(let round=1;round<=rounds;round++)for(const origin of targets)for(const[method,path]of maintenanceChecks){
  const response=await request(new URL(path,origin),{method});const h=response.headers;
  if(response.status!==503||h['x-vinyl-maintenance']!==token||h['x-vinyl-gate-config']!==token||!/(?:^|,)\s*no-store\s*(?:,|$)/i.test(h['cache-control']||'')||!/^\d+$/.test(h['retry-after']||''))throw Error('MAINTENANCE_NOT_PROVEN');
  results.push({round,origin,method,path,status:response.status});
 }
 return{passed:true,rounds,checks:results};
}
export async function waitForWorkerRetirement({pids,timeout=10000,alive=async()=>{
 const {stdout}=await exec('ps',['-e','-o','pid='],{timeout:1000,maxBuffer:1024*1024});return new Set(stdout.trim().split(/\s+/).map(Number));
},now=Date.now,pause=ms=>new Promise(r=>setTimeout(r,ms))}){
 if(!Array.isArray(pids)||!pids.length||pids.some(p=>!Number.isSafeInteger(p)||p<2)||!Number.isInteger(timeout)||timeout<1||timeout>60000)throw Error('INVALID_WORKER_SNAPSHOT');
 const deadline=now()+timeout;
 while(true){const current=await alive();if(pids.every(pid=>!current.has(pid)))return{retired:true};if(now()>=deadline)throw Error('OLD_WORKERS_NOT_RETIRED');await pause(50);}
}
