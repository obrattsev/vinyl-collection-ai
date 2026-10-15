import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmailService} from '../server/security/email.mjs';
const env={NODE_ENV:'development',EMAIL_ADAPTER:'smtp',POSTBOX_KEY_ID:'fixture-key',POSTBOX_KEY_SECRET:'fixture-secret',POSTBOX_TEST_EMAIL:'approved@example.test'};
test('Postbox adapter uses verified TLS and API key auth, sends both templates only to approved local recipient',async()=>{
 let options;const sent=[];
 const mail=createEmailService(env,{createTransport:value=>{options=value;return {sendMail:async message=>{sent.push(message);return {accepted:[message.to]};}};}});
 for(const purpose of ['EMAIL_VERIFICATION','PASSWORD_RESET'])assert.equal(await mail.send({email:env.POSTBOX_TEST_EMAIL,code:'123456',purpose}),'accepted');
 assert.equal(options.host,'postbox.cloud.yandex.net');assert.equal(options.port,465);assert.equal(options.secure,true);
 assert.equal(options.tls.rejectUnauthorized,true);assert.equal(options.tls.minVersion,'TLSv1.2');
 assert.equal(options.logger,false);assert.equal(options.debug,false);
 assert.deepEqual(options.auth,{user:'fixture-key',pass:'fixture-secret'});
 assert.equal(sent.length,2);assert.notEqual(sent[0].subject,sent[1].subject);assert.match(sent[0].from,/no-reply@vinyl-collection.ru/);
 assert.equal(await mail.send({email:'other@example.test',code:'123456',purpose:'EMAIL_VERIFICATION'}),'failed');assert.equal(sent.length,2);
 assert.throws(()=>createEmailService({...env,POSTBOX_TEST_EMAIL:undefined}));
});
test('SMTP rejection, uncertain timeout and refused recipient never expose transport details',async()=>{
 for(const [result,state] of [[{responseCode:535},'failed'],[{responseCode:550},'failed'],[{responseCode:451},'failed'],[{code:'ECONNREFUSED'},'unknown'],[{code:'ETIMEDOUT'},'unknown'],[null,'failed']]){
   const mail=createEmailService(env,{createTransport:()=>({sendMail:async()=>{if(result)throw Object.assign(Error('fixture provider sensitive response'),result);return {accepted:[],rejected:[env.POSTBOX_TEST_EMAIL]};}})});
   assert.equal(await mail.send({email:env.POSTBOX_TEST_EMAIL,code:'123456',purpose:'PASSWORD_RESET'}),state);
 }
});

test('real MIME serialization keeps expected headers and UTF-8 without transport secrets',async()=>{
 const {default:nodemailer}=await import('nodemailer');
 for(const purpose of ['EMAIL_VERIFICATION','PASSWORD_RESET']){
  let raw;
  const mail=createEmailService(env,{createTransport:()=>({sendMail:async message=>{
   const result=await nodemailer.createTransport({streamTransport:true,buffer:true,newline:'windows'}).sendMail(message);
   raw=result.message.toString();return {accepted:[message.to]};
  }})});
  assert.equal(await mail.send({email:env.POSTBOX_TEST_EMAIL,code:'123456',purpose}),'accepted');
  const [headers,...body]=raw.split('\r\n\r\n');
  assert.match(headers,/From: Vinyl Collection <no-reply@vinyl-collection.ru>/);
  assert.match(headers,/To: approved@example.test/);
  assert.match(headers,/Content-Type: text\/plain; charset=utf-8/i);
  assert.match(headers,/Subject: =\?UTF-8\?/i);
  assert.doesNotMatch(headers,/Reply-To:|X-Mailer:|X-Originating-IP:/i);
  for(const value of [env.POSTBOX_KEY_ID,env.POSTBOX_KEY_SECRET,'DATABASE_URL','AUTH_SECRET'])assert.ok(!raw.includes(value));
  const encoded=body.join('\r\n\r\n');
  const decoded=/Content-Transfer-Encoding: base64/i.test(headers)?Buffer.from(encoded,'base64').toString('utf8'):Buffer.from(encoded.replace(/=\r\n/g,'').replace(/=([0-9A-F]{2})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16))),'binary').toString('utf8');
  assert.match(decoded,/123456/);assert.match(decoded,/10 минут/);
  assert.ok(decoded.includes(purpose==='PASSWORD_RESET'?'восстановления пароля':'подтверждения email'));
 }
});

test('common SMTP availability probe returns safe failure for connection, timeout, auth and temporary rejection',async()=>{
 for(const error of [{code:'ECONNREFUSED'},{code:'ETIMEDOUT'},{responseCode:535},{responseCode:451}]){
  const mail=createEmailService(env,{createTransport:()=>({verify:async()=>{throw Object.assign(Error('secret provider details'),error);}})});
  assert.equal(await mail.check(),false);
 }
 const mail=createEmailService(env,{createTransport:()=>({verify:async()=>true})});assert.equal(await mail.check(),true);
});
test('SMTP common probe is shared by concurrent requests without recipient data',async()=>{
 let resolve,calls=0;
 const mail=createEmailService(env,{createTransport:()=>({verify:()=>{calls++;return new Promise(r=>resolve=r);}})});
 const a=mail.check(),b=mail.check();await Promise.resolve();assert.equal(calls,1);
 resolve(true);assert.deepEqual(await Promise.all([a,b]),[true,true]);
});

test('report mail has independent fixed recipient, verified From, stable ID and user text only in plain body',async()=>{
 const sent=[];
 const mail=createEmailService(env,{createTransport:()=>({sendMail:async m=>{sent.push(m);return {accepted:[m.to]};}})});
 const notice={recipient:env.POSTBOX_TEST_EMAIL,id:'11111111-1111-4111-8111-111111111111',userId:'22222222-2222-4222-8222-222222222222',createdAt:'2026-10-15T10:00:00.000Z',section:'collection',page:'/fixture/collection',text:'<script>alert(1)</script>\nBcc: attacker@example.test\n=FORMULA()'};
 assert.equal(await mail.sendReport({...notice,from:'attacker@example.test'}),'accepted');
 const m=sent[0];assert.equal(m.to,env.POSTBOX_TEST_EMAIL);assert.equal(m.from,'Vinyl Collection <no-reply@vinyl-collection.ru>');
 assert.equal(m.subject,'Vinyl Collection: отчёт об ошибке');assert.equal(m.messageId,`<bug-report.${notice.id}@vinyl-collection.ru>`);
 assert.equal(m.html,undefined);assert.equal(m.bcc,undefined);assert.equal(m.replyTo,undefined);assert.equal(m.attachments,undefined);
 for(const value of [notice.id,notice.userId,notice.createdAt,notice.page,notice.text])assert.ok(m.text.includes(value));
 assert.equal(await mail.sendReport({...notice,recipient:'other@example.test'}),'failed');assert.equal(sent.length,1);
 assert.throws(()=>mail.sendReport({...notice,recipient:'ok@example.test\r\nBcc: other@example.test'}));
});
