import test from 'node:test';
import assert from 'node:assert/strict';
import {reportNotificationConfiguration,reportPage,startReportDelivery} from '../server/report-delivery.mjs';
import {prototypeUI} from './fixtures/prototype-dom.mjs';
test('report recipient is explicit and independent; report page rejects secrets/external URLs',()=>{
 assert.equal(reportNotificationConfiguration({}),null);
 assert.throws(()=>reportNotificationConfiguration({BUG_REPORT_NOTIFICATIONS_ENABLED:'true',POSTBOX_TEST_EMAIL:'owner@example.test'}));
 assert.deepEqual(reportNotificationConfiguration({BUG_REPORT_NOTIFICATIONS_ENABLED:'true',BUG_REPORT_EMAIL_TO:'Owner@example.test'}),{recipient:'owner@example.test'});
 for(const page of ['https://example.test','//example.test','/collection?token=secret','/auth','/collection\nX: 1','/%61/collection'])assert.throws(()=>reportPage(page));
 assert.equal(reportPage('/fixture/collection/'),'/fixture/collection');assert.equal(reportPage(null),null);
});
test('UI retries unchanged report with same key, uses a new key for changed content and submits only authenticated',async()=>{
 const calls=[];const ui=await prototypeUI(async(url,options)=>{calls.push(options);throw Error('lost HTTP response');},{owner:true});
 await ui.get('#open-report').fire('click');ui.get('#report-text').value='same text';
 await ui.get('#report-form').fire('submit');await ui.get('#report-form').fire('submit');
 assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);
 ui.get('#report-text').value='changed';await ui.get('#report-form').fire('submit');
 assert.notEqual(calls[0].headers['Idempotency-Key'],calls[2].headers['Idempotency-Key']);
 assert.equal(JSON.parse(calls[0].body).page,'/collection');
 ui.run("applySession({role:'guest'})");await ui.get('#report-form').fire('submit');assert.equal(calls.length,3);
});
test('delivery interval does not overlap or start another pump after close',async()=>{
 let finish,calls=0;const service={pump:()=>{calls++;return new Promise(resolve=>finish=resolve);}};
 const worker=startReportDelivery(service,{interval:5});await new Promise(resolve=>setTimeout(resolve,20));assert.equal(calls,1);
 const stopped=worker.close();finish();await stopped;await new Promise(resolve=>setTimeout(resolve,10));assert.equal(calls,1);
});
