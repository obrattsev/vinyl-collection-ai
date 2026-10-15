import test from'node:test';import assert from'node:assert/strict';
import{mkdtemp,writeFile,readFile,rm,unlink}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
import{spawn,execFile}from'node:child_process';import{promisify}from'node:util';import http from'node:http';import https from'node:https';import{once}from'node:events';
import{maintenanceSnippet,checkMaintenance,waitForWorkerRetirement,readProbe,captureMaintenanceBaseline,checkMaintenanceArmed}from'../ops/maintenance-gate.mjs';
const exec=promisify(execFile),binary=process.env.NGINX_TEST_BIN;
test('isolated nginx: reload race, ingress/auth/write barriers, HTTP/HTTPS and flag lifecycle',{skip:!binary,timeout:45000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'vinyl-maintenance-'));let master,upstream,keepAgent;const token='a'.repeat(32),flag=join(dir,'maintenance.flag'),config=join(dir,'nginx.conf');let stopped=false,upstreamCalls=0,writes=0;const evidence={platform:process.platform,nginxVersion:'1.24.0',naturalReloads:[],routes:0};
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const poll=async fn=>{const end=Date.now()+5000;while(Date.now()<end){if(await fn())return;await sleep(20);}throw Error('ISOLATED_NGINX_TIMEOUT');};
 const port=async()=>{const s=http.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;};
 try{
  upstream=http.createServer((req,res)=>{upstreamCalls++;if(!['GET','HEAD'].includes(req.method)||(req.method==='GET'&&req.url==='/api/auth/bootstrap'))writes++;req.resume();res.end('fixture upstream');});upstream.listen(0,'127.0.0.1');await once(upstream,'listening');const appPort=upstream.address().port,hp=await port(),sp=await port();
  await writeFile(join(dir,'cert.conf'),'[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=vinyl.test\n[ext]\nsubjectAltName=DNS:vinyl.test,DNS:www.vinyl.test,IP:127.0.0.1\n');await exec(process.env.OPENSSL_TEST_BIN||'openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-config',join(dir,'cert.conf'),'-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem')]);const ca=await readFile(join(dir,'cert.pem'));
  const call=async(url,{method='GET',client='198.51.100.10',headers={},agent=false}={})=>new Promise((resolve,reject)=>{const u=new URL(url),secure=u.protocol==='https:';const req=(secure?https:http).request({hostname:'127.0.0.1',port:u.port,path:u.pathname+u.search,servername:u.hostname,ca,method,agent,headers:{Host:u.host,Connection:'close','X-Fixture-Client':client,...headers}},res=>{const result={status:res.statusCode,headers:res.headers,reusedSocket:req.reusedSocket};res.resume();res.on('end',()=>resolve(result));});req.on('error',reject);req.setTimeout(1500,()=>req.destroy(Error('fixture timeout')));req.end();});
  const base=`https://vinyl.test:${sp}`,urls=[`http://vinyl.test:${hp}`,`http://www.vinyl.test:${hp}`,base,`https://www.vinyl.test:${sp}`];
  const render=async kind=>{
   const old=`set $gate 0; if (-f ${flag}) { set $gate 1; } if ($remote_addr = 127.0.0.1) { set $gate 0; } if ($remote_addr = ::1) { set $gate 0; } if ($remote_addr = 192.0.2.8) { set $gate 0; } if ($gate = 1) { return 503; }`;
   const fixed=maintenanceSnippet({flag,token}),gate=kind==='fixed'?fixed:kind==='old'?old:'';
   await writeFile(config,`worker_processes 1; pid ${dir}/nginx.pid; error_log ${dir}/error.log notice; events {worker_connections 128;} http { log_format trace '$msec|$pid|$status|$request|$upstream_addr'; access_log ${dir}/access.log trace; set_real_ip_from 127.0.0.1; real_ip_header X-Fixture-Client;
server { listen 127.0.0.1:${hp}; server_name vinyl.test www.vinyl.test; ${kind==='fixed'?fixed:''} location / { return 301 https://vinyl.test:${sp}$request_uri; } }
server { listen 127.0.0.1:${sp} ssl; server_name vinyl.test; ssl_certificate ${dir}/cert.pem; ssl_certificate_key ${dir}/key.pem; add_header X-Fixture-Worker $pid always; ${gate} location ~ ^/api/(collection|wishlist)/[0-9a-fA-F-]+/cover$ { proxy_cache off; proxy_pass http://127.0.0.1:${appPort}; } location / { proxy_cache off; proxy_pass http://127.0.0.1:${appPort}; } }
server { listen 127.0.0.1:${sp} ssl; server_name www.vinyl.test; ssl_certificate ${dir}/cert.pem; ssl_certificate_key ${dir}/key.pem; ${kind==='fixed'?fixed:''} return 301 https://vinyl.test:${sp}$request_uri; }
}`);
  };
  const reload=async()=>exec(binary,['-p',dir+'/', '-c',config,'-s','reload']);
  await render('none');await exec(binary,['-p',dir+'/', '-c',config,'-t']);master=spawn(binary,['-p',dir+'/', '-c',config,'-g','daemon off;'],{stdio:'ignore'});await poll(async()=>{try{return(await call(base)).status===200;}catch(error){evidence.startError=error.message;return false;}});delete evidence.startError;
  await t.test('reload command can return success while the old worker still serves HTTP 200',async()=>{
   const before=await call(base);await writeFile(flag,'on',{mode:0o644});await render('old');process.kill(master.pid,'SIGSTOP');stopped=true;
   await reload();const response=await call(base);assert.equal(response.status,200);assert.equal(response.headers['x-fixture-worker'],before.headers['x-fixture-worker']);
   evidence.delayedReload={commandSucceeded:true,status:response.status,sameOldWorker:true,oldPid:before.headers['x-fixture-worker'],observedPid:response.headers['x-fixture-worker'],cache:false};process.kill(master.pid,'SIGCONT');stopped=false;await poll(async()=>(await call(base)).status===503);await waitForWorkerRetirement({pids:[Number(before.headers['x-fixture-worker'])]});
   assert.equal(writes,0);
  });
  await t.test('original canonical HTTPS gate blocks public writes, but operator exception and redirects are broader than intended',async()=>{
   assert.equal((await call(base+'/api/auth/registration',{method:'POST'})).status,503);
   assert.equal((await call(base+'/api/collection/11111111-1111-4111-8111-111111111111/cover',{method:'PUT'})).status,503);
   assert.equal((await call(urls[0])).status,301);assert.equal((await call(urls[3])).status,301);
   const before=writes;assert.equal((await call(base+'/api/auth/registration',{method:'POST',client:'127.0.0.1'})).status,200);assert.equal((await call(base+'/api/auth/bootstrap',{client:'127.0.0.1'})).status,200);assert.equal(writes,before+2);evidence.oldOperatorExceptionAllowsWrites=true;
  });
  await t.test('unmodified reload timing is observed with worker evidence, without assuming every run races',async()=>{
   for(let i=0;i<5;i++){
    await unlink(flag);const old=(await call(base)).headers['x-fixture-worker'];await render('none');await reload();await waitForWorkerRetirement({pids:[Number(old)]});const before=await call(base);await writeFile(flag,'on');await render('old');await reload();const returnedAt=Date.now();const response=await call(base);
    assert.ok([200,503].includes(response.status));if(response.status===200)assert.equal(response.headers['x-fixture-worker'],before.headers['x-fixture-worker']);evidence.naturalReloads.push({status:response.status,oldWorker:response.status===200,oldPid:before.headers['x-fixture-worker'],observedPid:response.headers['x-fixture-worker'],msAfterReloadReturn:Date.now()-returnedAt});await poll(async()=>(await call(base)).status===503);await waitForWorkerRetirement({pids:[Number(before.headers['x-fixture-worker'])]});
   }
  });
  await t.test('install with flag absent, retire old workers, then atomically enable without another reload',async()=>{
   await unlink(flag);const baseline=await captureMaintenanceBaseline({urls,request:call});const old=(await call(base)).headers['x-fixture-worker'];await render('fixed');await reload();await waitForWorkerRetirement({pids:[Number(old)]});
   assert.equal((await checkMaintenanceArmed({baseline,token,request:call})).armed,true);keepAgent=new https.Agent({keepAlive:true,maxSockets:1,ca});await call(base,{agent:keepAgent,headers:{Connection:'keep-alive'}});
   upstreamCalls=0;writes=0;await writeFile(flag,'on',{mode:0o644});const reused=await call(base,{agent:keepAgent,headers:{Connection:'keep-alive'}});assert.equal(reused.status,503);assert.equal(reused.reusedSocket,true);evidence.keepAliveBlocked=true;keepAgent.destroy();keepAgent=null;const checked=await checkMaintenance({urls,token,request:call});assert.equal(checked.passed,true);assert.equal(upstreamCalls,0);evidence.readOnlyProbeChecks=checked.checks.length;
  });
  await t.test('all public methods, auth/bootstrap, API/regex/media routes and operator-IP/header spoof attempts stop before upstream',async()=>{
   const paths=['/','/auth','/collection','/wishlist','/obrattsev/collection','/obrattsev/wishlist','/api/auth/bootstrap','/api/auth/registration','/api/auth/login','/api/auth/logout','/api/auth/complete','/api/auth/verify','/api/auth/resend','/api/auth/forgot','/api/auth/settings','/api/auth/change-password','/api/auth/delete-account','/api/bug-reports','/api/collection','/api/wishlist','/api/u/obrattsev/collection','/api/collection/11111111-1111-4111-8111-111111111111/cover','/api/wishlist/11111111-1111-4111-8111-111111111111/cover','/media/covers/fixture/image.webp'];
   for(const origin of urls)for(const path of paths)for(const method of['GET','HEAD','POST','PUT','PATCH','DELETE']){const r=await call(origin+path,{method,headers:{Cookie:'fixture-only','X-Collection-View':'1','X-Forwarded-For':'127.0.0.1'}});assert.equal(r.status,503);assert.equal(r.headers['x-vinyl-maintenance'],token);evidence.routes++;}
   for(const client of['127.0.0.1','192.0.2.8'])assert.equal((await call(base+'/api/auth/login',{method:'POST',client})).status,503);
   assert.equal(upstreamCalls,0);assert.equal(writes,0);assert.equal((await readProbe(`http://127.0.0.1:${appPort}/`,{method:'GET'})).status,200);assert.equal(writes,0);evidence.fixedUpstreamWrites=0;
  });
  await t.test('flag removal restores prior routing without reload',async()=>{
   await unlink(flag);for(let i=0;i<urls.length;i++){const r=await call(urls[i]);assert.equal(r.status,i===2?200:301);assert.equal(r.headers['x-vinyl-maintenance'],undefined);}
   assert.equal((await call(base+'/api/auth/login',{method:'POST'})).status,200);assert.equal(writes,1);evidence.offRestoresRouting=true;
  });
  if(process.env.MAINTENANCE_TEST_EVIDENCE)await writeFile(process.env.MAINTENANCE_TEST_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');
 }finally{
  if(evidence.startError)console.log('Fixture startup:',evidence.startError);
  keepAgent?.destroy();if(master){if(stopped)process.kill(master.pid,'SIGCONT');master.kill('SIGQUIT');await Promise.race([once(master,'exit'),sleep(2000)]);}
  if(upstream)await new Promise(r=>upstream.close(r));await rm(dir,{recursive:true,force:true});
 }
});
