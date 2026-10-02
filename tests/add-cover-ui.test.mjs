import test from 'node:test';
import assert from 'node:assert/strict';
import { prototypeUI, response, deferred } from './fixtures/prototype-dom.mjs';
import { record } from './fixtures/collection.mjs';
import { wish } from './fixtures/wishlist.mjs';
import { recordRevision } from '../src/collection-record.mjs';
import { wishlistRevision } from '../src/wishlist-record.mjs';
const coverId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const validFile = {type:'image/png',size:100};
const all = n => [n,...n.children.flatMap(all)];
globalThis.FileReader = class { readAsDataURL() { this.result='data:image/png;base64,dGVzdA=='; this.onload(); } };
async function prepare(ui, source, file) {
  await ui.get('#add-record').fire('click');
  const {id,coverId,favorite,...draft}=source;
  ui.fill({...draft,...('purchaseDate' in draft ? {purchaseDate:'03.09.2026'} : {})});
  if(file){ui.get('#add-cover-file').files=[file];await ui.get('#add-cover-file').fire('change');}
  await ui.get('#record-form').fire('submit');
}
for(const wishlist of [false,true]) {
 const source=wishlist?wish:record, endpoint=wishlist?'/api/wishlist':'/api/collection';
 for(const outcome of ['no-cover','success','metadata-error','metadata-unknown','cover-error','cover-unknown','wrong-created','wrong-cover']) {
  test(`initial Add ${wishlist}/${outcome}: ordered writes, confirmed target, no rollback/retry`,async()=>{
   const writes=[];let current=null;
   const ui=await prototypeUI(async(url,options={})=>{
    if(!options.method)return response(url===endpoint&&current?[current]:[]);
    writes.push({url,...options});
    if(options.method==='POST'){
     if(outcome.startsWith('metadata-'))return {ok:false,json:async()=>({error:outcome==='metadata-unknown'?'RESULT_UNCONFIRMED':'INVALID_RECORD'})};
     current={...source};return response(outcome==='wrong-created'?{...current,album:'Wrong record'}:current);
    }
    assert.equal(options.method,'PUT');assert.equal(url,`${endpoint}/${source.id}/cover`);
    assert.equal(options.headers['If-Match'],await (wishlist?wishlistRevision:recordRevision)(source));
    assert.equal(options.headers['X-CSRF-Token'],'test-csrf');assert.equal(options.body,validFile);
    if(outcome.startsWith('cover-'))return {ok:false,json:async()=>({error:outcome==='cover-unknown'?'RESULT_UNCONFIRMED':'INVALID_COVER'})};
    current={...source,coverId};return response(outcome==='wrong-cover'?{...current,id:coverId}:current);
   },{wishlist});
   await prepare(ui,source,outcome==='no-cover'?null:validFile);
   assert.equal(ui.get('#confirm-record').hidden,false);
   await ui.get('#confirm-record').fire('click');
   assert.deepEqual(writes.map(w=>w.method),outcome==='no-cover'||outcome.startsWith('metadata-')||outcome==='wrong-created'?['POST']:['POST','PUT']);
   assert.ok(!/cover|favorite/i.test(JSON.stringify(JSON.parse(writes[0].body))));
   if(outcome.startsWith('metadata-')||outcome==='wrong-created'){
    assert.equal(ui.get('#record-dialog').open,true);assert.ok(ui.get('#record-error').textContent);
    if(outcome!=='metadata-error')assert.equal(ui.run('needsRefresh'),true);
   }else{
    assert.equal(ui.get('#record-dialog').open,false);
    assert.equal(ui.run('displayedRecords.length'),1);assert.equal(current.id,source.id);
    if(outcome.startsWith('cover-')||outcome==='wrong-cover')assert.match(ui.get('#operation-status').textContent,/Пластинка добавлена,/);
    else {assert.match(ui.get('#operation-status').textContent,/^Добавлено:/);assert.equal(ui.run('displayedRecords[0].coverId'),outcome==='success'?coverId:null);}
    if(outcome==='cover-unknown'||outcome==='wrong-cover')assert.equal(ui.run('needsRefresh'),true);
   }
   assert.equal(writes.some(w=>w.method==='DELETE'),false);
   const count=writes.length;await ui.get('#confirm-record').fire('click');assert.equal(writes.length,count);
  });
 }
 test(`initial Add ${wishlist}: invalid type/size, clear selection, cancel and reopen`,async()=>{
  let writes=0;const ui=await prototypeUI(async(_,opts={})=>{if(opts.method)writes++;return response([]);},{wishlist});
  for(const file of [{type:'image/heic',size:100},{type:'image/png',size:10*1024*1024+1}]){
   await prepare(ui,source,file);assert.equal(ui.get('#confirm-record').hidden,true);assert.match(ui.get('#add-cover-error').textContent,/HEIC/);
   await ui.get('#clear-add-cover').fire('click');assert.equal(ui.get('#add-cover-error').textContent,'');
   await ui.get('#record-form').fire('submit');assert.equal(ui.get('#confirm-record').hidden,false);
   await ui.get('#cancel-record').fire('click');
  }
  await prepare(ui,source,validFile);assert.equal(ui.get('#add-cover-preview').hidden,false);
  await ui.get('#cancel-record').fire('click');await ui.get('#add-record').fire('click');
  assert.equal(ui.get('#add-cover-file').value,'');assert.equal(ui.get('#add-cover-preview').hidden,true);assert.equal(ui.get('#add-cover-preview').children.length,0);assert.equal(writes,0);
  await ui.get('#cancel-record').fire('click');await ui.run(`openEdit(${JSON.stringify(source)})`);assert.equal(ui.get('#add-cover-field').hidden,true);
 });
}
test('initial Add file read cannot repopulate a cancelled/reopened form; pending read prevents confirmation',async()=>{
 const Original=globalThis.FileReader;let reader;
 globalThis.FileReader=class{readAsDataURL(){reader=this;}};
 try{
  const ui=await prototypeUI(async()=>response([]));await prepare(ui,record,validFile);
  assert.equal(ui.get('#confirm-record').hidden,true);assert.match(ui.get('#record-error').textContent,/Дождитесь/);
  await ui.get('#cancel-record').fire('click');await ui.get('#add-record').fire('click');reader.result='data:image/png;base64,dGVzdA==';reader.onload();
  assert.equal(ui.get('#add-cover-preview').hidden,true);assert.equal(ui.run('addCover.file'),null);
 }finally{globalThis.FileReader=Original;}
});
test('initial Add stays busy across cover upload; duplicate confirm cannot create or upload twice',async()=>{
 const pending=deferred(),writes=[];const ui=await prototypeUI(async(_,opts={})=>{
  if(!opts.method)return response([]);writes.push(opts.method);return opts.method==='POST'?response(record):pending.promise;
 });await prepare(ui,record,validFile);const work=ui.get('#confirm-record').fire('click');
 await new Promise(r=>setTimeout(r,5));assert.deepEqual(writes,['POST','PUT']);
 await ui.get('#confirm-record').fire('click');await ui.get('#cancel-record').fire('click');assert.equal(ui.get('#record-dialog').open,true);
 pending.resolve(response({...record,coverId}));await work;assert.deepEqual(writes,['POST','PUT']);
});
test('mobile wishlist Transfer changes only variant; same text/order and existing handoff',async()=>{
 const ui=await prototypeUI(async()=>response([wish]),{wishlist:true,compact:true});
 await ui.get('#load-collection').fire('click');await all(ui.get('#mobile-records')).find(n=>n.className==='compact-record').fire('click');
 const buttons=ui.get('#detail-actions').children;
 assert.deepEqual(buttons.map(b=>b.textContent),['Редактировать','Удалить','Добавить в коллекцию']);
 assert.equal(buttons[0].className,'button-secondary');assert.equal(buttons[1].className,'button-secondary');assert.equal(buttons[2].className,'');
 await buttons[2].fire('click');assert.equal(ui.get('#detail-dialog').open,false);assert.equal(ui.get('#record-dialog').open,true);assert.equal(ui.get('#add-cover-field').hidden,true);
});
