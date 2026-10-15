import test from'node:test';import assert from'node:assert/strict';
import{maintenanceSnippet,maintenanceChecks,checkMaintenance,waitForWorkerRetirement,readProbe,captureMaintenanceBaseline,checkMaintenanceArmed}from'../ops/maintenance-gate.mjs';
const token='a'.repeat(32),good={status:503,headers:{'x-vinyl-maintenance':token,'x-vinyl-gate-config':token,'cache-control':'no-store','retry-after':'60'}};
test('maintenance probes are read-only, fresh, cover API/auth/cover regex, and all configured origins',async()=>{
 const calls=[];const result=await checkMaintenance({urls:['http://example.test','https://example.test','http://www.example.test','https://www.example.test'],token,request:async(u,o)=>{calls.push([String(u),o.method]);return good;}});
 assert.equal(result.checks.length,maintenanceChecks.length*4*3);assert.ok(calls.every(([,m])=>['GET','HEAD'].includes(m)));assert.ok(calls.some(([u,m])=>u.endsWith('/api/auth/bootstrap')&&m==='HEAD'));
});
for(const fault of['open','redirect','stale-marker','upstream-503','cached','network'])test(`maintenance stops immediately on ${fault}; never treats a later 503 as recovery`,async()=>{
 let calls=0;await assert.rejects(checkMaintenance({urls:['https://example.test'],token,request:async()=>{
  calls++;if(calls>1)return good;if(fault==='network')throw Error('offline');
  return{...good,status:fault==='open'?200:fault==='redirect'?301:503,headers:{...good.headers,...(fault==='stale-marker'?{'x-vinyl-maintenance':'b'.repeat(32)}:fault==='upstream-503'?{'x-vinyl-gate-config':undefined}:fault==='cached'?{'cache-control':'public, max-age=60'}:{})}};
 }}));assert.equal(calls,1);
});
test('worker drain is a separate mandatory gate with a bounded deadline',async()=>{
 let tick=0;const result=await waitForWorkerRetirement({pids:[123,124],now:()=>tick,pause:async ms=>{tick+=ms;},alive:async()=>new Set(tick<100?[123]:[])});assert.equal(result.retired,true);assert.equal(tick,100);
 await assert.rejects(waitForWorkerRetirement({pids:[123],timeout:100,now:()=>tick,pause:async ms=>{tick+=ms;},alive:async()=>new Set([123])}),/NOT_RETIRED/);
});
test('invalid flags/tokens, credentials and state-changing probe methods are refused',async()=>{
 for(const flag of['relative','/tmp/../real','/tmp/x; return 200;','/tmp/x\n'])assert.throws(()=>maintenanceSnippet({flag,token}));
 assert.throws(()=>maintenanceSnippet({flag:'/tmp/fixture.flag',token:'";'}));
 await assert.rejects(checkMaintenance({urls:['https://u:secret@example.test'],token,request:async()=>good}));
 await assert.rejects(readProbe('https://example.test',{method:'POST'}));
});

test('armed configuration must preserve the full baseline before flag activation',async()=>{
 const baseline=await captureMaintenanceBaseline({urls:['https://example.test'],request:async()=>({status:200,headers:{}})});
 assert.equal((await checkMaintenanceArmed({baseline,token,request:async()=>({status:200,headers:{'x-vinyl-gate-config':token}})})).armed,true);
 for(const r of [{status:503,headers:{'x-vinyl-gate-config':token}},{status:200,headers:{}},{status:301,headers:{'x-vinyl-gate-config':token}}])await assert.rejects(checkMaintenanceArmed({baseline,token,request:async()=>r}));
 await assert.rejects(checkMaintenanceArmed({baseline:baseline.slice(1),token,request:async()=>good}));
});
