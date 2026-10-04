import test from 'node:test';
import assert from 'node:assert/strict';
import {retainedBackups} from '../server/postgres/retention.mjs';
test('backup retention keeps seven newest daily and four independent weekly restore points',()=>{
 const dates=Array.from({length:50},(_,i)=>new Date(Date.UTC(2026,9,4-i)).toISOString().replaceAll('-','').replaceAll(':','').replace(/\.\d{3}Z$/,'Z'));
 const keep=retainedBackups(dates);assert.ok(dates.slice(0,7).every(d=>keep.has(d)));assert.ok(keep.has('20260927T000000Z'));assert.ok(keep.has('20260920T000000Z'));assert.ok(keep.has('20260913T000000Z'));assert.equal(keep.has(dates.at(-1)),false);
 assert.throws(()=>retainedBackups(['../other']));
});
