import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prototypeUI,response,deferred} from './fixtures/prototype-dom.mjs';
import {record} from './fixtures/collection.mjs';
import {wish} from './fixtures/wishlist.mjs';
import {recordRevision} from '../src/collection-record.mjs';
import {wishlistRevision} from '../src/wishlist-record.mjs';
const coverId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
for(const wishlist of [false,true])for(const compact of [false,true]){
 const endpoint=wishlist?'/api/wishlist':'/api/collection',source={...(wishlist?wish:record),coverId};
 const revision=wishlist?wishlistRevision:recordRevision;
 test(`forms ${wishlist}/${compact}: Edit removes cover only after final confirmation with fresh revision`,async()=>{
  let current={...source};const writes=[];
  const ui=await prototypeUI(async(url,options={})=>{
   if(!options.method)return response(url===endpoint?[current]:[]);
   writes.push({url,...options});
   current=options.method==='DELETE'?{...current,coverId:null}:{...current,...JSON.parse(options.body)};
   return response(current);
  },{wishlist,compact});
  await ui.run(`openEdit(${JSON.stringify(source)})`);
  assert.equal(ui.get('#preview-record').textContent,'Изменить');assert.equal(ui.get('#edit-cover-field').hidden,false);
  ui.fill({note:'Edited draft'});await ui.get('#edit-remove-cover').fire('click');assert.equal(writes.length,0);
  assert.equal(ui.get('#edit-keep-cover').hidden,false);
  await ui.get('#record-form').fire('submit');assert.equal(writes.length,0);assert.equal(ui.get('#edit-cover-field').hidden,true);
  assert.ok(ui.get('#record-preview').children.some(n=>n.textContent.includes('Обложка будет удалена')));
  await ui.get('#confirm-record').fire('click');
  assert.deepEqual(writes.map(w=>w.method),['PUT','DELETE']);assert.equal(writes[1].url,endpoint+'/'+source.id+'/cover');
  assert.equal(writes[1].headers['If-Match'],await revision({...source,note:'Edited draft'}));
  assert.equal(writes[1].headers['X-CSRF-Token'],'test-csrf');assert.equal(current.coverId,null);assert.equal(current.note,'Edited draft');
 });
 test(`forms ${wishlist}/${compact}: cancel, undo and no-cover never delete or leak staged removal`,async()=>{
  const writes=[];const ui=await prototypeUI(async(url,o={})=>{if(o.method)writes.push(o);return response(url===endpoint?[source]:[]);},{wishlist,compact});
  await ui.run(`openEdit(${JSON.stringify(source)})`);await ui.get('#edit-remove-cover').fire('click');
  await ui.get('#edit-keep-cover').fire('click');assert.equal(ui.run('pendingCoverRemoval'),false);
  await ui.get('#edit-remove-cover').fire('click');await ui.get('#cancel-record').fire('click');assert.equal(writes.length,0);
  await ui.get('#add-record').fire('click');assert.equal(ui.run('pendingCoverRemoval'),false);assert.equal(ui.get('#preview-record').textContent,'Добавить');assert.equal(ui.get('#edit-cover-field').hidden,true);
  await ui.get('#cancel-record').fire('click');await ui.run(`openEdit(${JSON.stringify({...source,coverId:null})})`);
  assert.equal(ui.get('#edit-cover-field').hidden,true);await ui.get('#edit-remove-cover').fire('click');assert.equal(ui.run('pendingCoverRemoval'),false);
 });
}
for(const outcome of ['metadata-error','delete-error','delete-unknown','wrong-metadata','session-change'])test(`Edit staged cover safety: ${outcome}`,async()=>{
 const source={...record,coverId};let current={...source},ui;const methods=[];
 ui=await prototypeUI(async(url,o={})=>{
  if(!o.method)return response(url==='/api/collection'?[current]:[]);
  methods.push(o.method);
  if(o.method==='PUT'){
   if(outcome==='metadata-error')return {ok:false,json:async()=>({error:'RECORD_CHANGED',record:{...source,note:'Concurrent change'}})};
   current={...current,...JSON.parse(o.body)};
   if(outcome==='session-change')ui.run("applySession({role:'guest'})");
   return response(outcome==='wrong-metadata'?{...current,id:coverId}:current);
  }
  return {ok:false,json:async()=>({error:outcome==='delete-unknown'?'RESULT_UNCONFIRMED':'COVER_BUSY'})};
 });
 await ui.run(`openEdit(${JSON.stringify(source)})`);ui.fill({note:'Changed'});await ui.get('#edit-remove-cover').fire('click');await ui.get('#record-form').fire('submit');await ui.get('#confirm-record').fire('click');
 assert.deepEqual(methods,outcome.startsWith('delete-')?['PUT','DELETE']:['PUT']);
 if(outcome.startsWith('delete-'))assert.match(ui.get('#operation-status').textContent,/Изменения сохранены/);
 if(outcome==='metadata-error')assert.equal(ui.run('pendingCoverRemoval'),false);
 assert.equal(current.coverId,coverId);
});
test('Edit duplicate confirmation and clicks while checking cannot repeat cover deletion',async()=>{
 const source={...record,coverId},pending=deferred();let current=source;const methods=[];
 const ui=await prototypeUI(async(url,o={})=>{
  if(!o.method)return response(url==='/api/collection'?[current]:[]);
  methods.push(o.method);if(o.method==='PUT'){current={...current,...JSON.parse(o.body)};return response(current);}
  return pending.promise;
 });
 await ui.run(`openEdit(${JSON.stringify(source)})`);await ui.get('#edit-remove-cover').fire('click');await ui.get('#record-form').fire('submit');
 const running=ui.get('#confirm-record').fire('click');while(methods.length<2)await new Promise(r=>setTimeout(r,1));
 await ui.get('#confirm-record').fire('click');await ui.get('#cancel-record').fire('click');assert.equal(ui.get('#record-dialog').open,true);
 current={...current,coverId:null};pending.resolve(response(current));await running;assert.deepEqual(methods,['PUT','DELETE']);
});
test('guest cannot stage cover removal; form placeholders are empty without changing numeric/date constraints',async()=>{
 const ui=await prototypeUI(async()=>response([]),{owner:false});await ui.run(`openEdit(${JSON.stringify({...record,coverId})})`);await ui.get('#edit-remove-cover').fire('click');assert.equal(ui.run('pendingCoverRemoval'),false);assert.equal(ui.get('#record-dialog').open,false);
 for(const field of ['albumYear','recordYear','purchaseDate','purchasePrice','salePrice'])assert.equal(ui.input(field).placeholder,'');
 assert.equal(ui.input('recordYear').maxLength,4);assert.equal(ui.input('purchaseDate').maxLength,10);
 for(const name of ['index','wishlist']){
  const html=await readFile(new URL(`../prototype/${name}.html`,import.meta.url),'utf8');
  assert.ok(!html.includes('Найдите нужные пластинки'));assert.ok(!html.includes('Обложка (необязательно)'));assert.match(html,/for="add-cover-file">Добавить обложку/);
 }
});
test('Add confirmation hides clear-file action; returning to draft restores active selection control',async()=>{
 const original=globalThis.FileReader;globalThis.FileReader=class{readAsDataURL(){this.result='data:image/png;base64,dGVzdA==';this.onload();}};
 try{
  const ui=await prototypeUI(async()=>response([]));await ui.get('#add-record').fire('click');
  const {id,coverId,favorite,...draft}=record;ui.fill({...draft,purchaseDate:'03.09.2026'});
  ui.get('#add-cover-file').files=[{type:'image/png',size:100}];await ui.get('#add-cover-file').fire('change');
  assert.equal(ui.get('#clear-add-cover').hidden,false);await ui.get('#record-form').fire('submit');assert.equal(ui.get('#clear-add-cover').hidden,true);
  await ui.get('#edit-draft').fire('click');assert.equal(ui.get('#clear-add-cover').hidden,false);assert.equal(ui.get('#clear-add-cover').disabled,false);
 }finally{globalThis.FileReader=original;}
});
