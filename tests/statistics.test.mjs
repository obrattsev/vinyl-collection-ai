import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {moscowDay,previousMoscowDay,dayBounds,statisticsConfiguration,statisticsMessage} from '../server/statistics.mjs';
import {createEmailService} from '../server/security/email.mjs';
test('Moscow calendar boundaries are half-open, year/leap rollover and invalid dates',()=>{
 assert.equal(moscowDay('2026-10-14T20:59:59.999Z'),'2026-10-14');
 assert.equal(moscowDay('2026-10-14T21:00:00.000Z'),'2026-10-15');
 assert.equal(previousMoscowDay('2026-01-01T07:00:00Z'),'2025-12-31');
 assert.equal(previousMoscowDay('2024-03-01T07:00:00Z'),'2024-02-29');
 assert.equal(dayBounds('2026-10-15').start.toISOString(),'2026-10-14T21:00:00.000Z');
 assert.equal(dayBounds('2026-10-15').end.toISOString(),'2026-10-15T21:00:00.000Z');
 assert.throws(()=>dayBounds('2026-02-30'));assert.throws(()=>dayBounds('bad'));
});
test('statistics requires explicit PG multiuser configuration and separate recipient',()=>{
 assert.equal(statisticsConfiguration({}),null);
 assert.throws(()=>statisticsConfiguration({STATISTICS_ENABLED:'yes'}));
 assert.throws(()=>statisticsConfiguration({STATISTICS_ENABLED:'true'}));
 assert.throws(()=>statisticsConfiguration({STATISTICS_ENABLED:'true',DATA_BACKEND:'postgres',AUTH_MODE:'multiuser'}));
 assert.equal(statisticsConfiguration({STATISTICS_ENABLED:'true',DATA_BACKEND:'postgres',AUTH_MODE:'multiuser',STATISTICS_EMAIL_TO:'obratsev@yandex.ru'}).recipient,'obratsev@yandex.ru');
});
const payload={day:'2026-10-14',partial:true,trackingStartedAt:'2026-10-14T10:00:00Z',snapshotAt:'2026-10-15T07:00:00Z',accounts:5,registrations:1,confirmed_accounts:4,nonempty_collections:2,active_users:3,collection_added:2,wishlist_added:1,bug_reports:1};
test('mail contains only aggregate counts, period and partial coverage; fixed sender/id',async()=>{
 const message=statisticsMessage({recipient:'obratsev@yandex.ru',payload});
 assert.match(message.text,/Неполные сутки/);assert.match(message.text,/Активные пользователи.*3/);
 assert.equal(message.from,'Vinyl Collection <no-reply@vinyl-collection.ru>');assert.equal(message.messageId,'<daily-statistics.2026-10-14@vinyl-collection.ru>');
 assert.throws(()=>statisticsMessage({recipient:'a@example.test',payload:{...payload,active_users:-1}}));
 let sent;const service=createEmailService({NODE_ENV:'production',EMAIL_ADAPTER:'smtp',POSTBOX_KEY_ID:'fixture',POSTBOX_KEY_SECRET:'fixture'}, {createTransport:()=>({sendMail:async m=>{sent=m;return {accepted:[m.to]};}})});
 assert.equal(await service.sendStatistics({recipient:'obratsev@yandex.ru',payload}),'accepted');assert.equal(sent.to,'obratsev@yandex.ru');
});
test('systemd schedule uses Moscow at 10:00 with bounded retry slots and same oneshot',async()=>{
 const timer=await readFile(new URL('../ops/systemd/vinyl-daily-statistics.timer',import.meta.url),'utf8');
 const retry=await readFile(new URL('../ops/systemd/vinyl-daily-statistics-retry.timer',import.meta.url),'utf8');
 assert.match(timer,/OnCalendar=\*-\*-\* 10:00:00 Europe\/Moscow/);assert.match(timer,/Persistent=true/);
 assert.match(retry,/10:05:00 Europe\/Moscow/);assert.match(retry,/10:10:00 Europe\/Moscow/);
});

for(const outcome of ['accepted','rejected','timeout'])test(`statistics Postbox adapter distinguishes ${outcome} without exposing provider errors`,async()=>{
 const service=createEmailService({NODE_ENV:'production',EMAIL_ADAPTER:'smtp',POSTBOX_KEY_ID:'fixture',POSTBOX_KEY_SECRET:'fixture'}, {createTransport:()=>({sendMail:async()=>{
  if(outcome==='accepted')return {accepted:['obratsev@yandex.ru']};
  throw Object.assign(Error('fixture provider secret'),outcome==='rejected'?{responseCode:550}:{code:'ETIMEDOUT'});
 }})});
 assert.equal(await service.sendStatistics({recipient:'obratsev@yandex.ru',payload}),{accepted:'accepted',rejected:'failed',timeout:'unknown'}[outcome]);
});
