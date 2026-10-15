import test from 'node:test';
import assert from 'node:assert/strict';
import {prototypeUI,response} from './fixtures/prototype-dom.mjs';
import {record} from './fixtures/collection.mjs';
import {wish} from './fixtures/wishlist.mjs';
for(const wishlist of [false,true])for(const compact of [false,true]){
 test(`visual package 1 ${wishlist}/${compact}: optional empties, zero and action ordering`,async()=>{
  const source={...(wishlist?wish:record),note:null,...(wishlist?{storeUrl:null}:{purchasePrice:0,purchaseStore:null,purchaseDate:null}),coverId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
  const ui=await prototypeUI(async()=>response([source]),{wishlist,compact});
  for(const target of ['#detail-content','#delete-preview']){
   ui.run(`displayRecord(document.querySelector('${target}'),${JSON.stringify(source)})`);
   const dl=ui.get(target).children[0];const values=new Map();for(let i=0;i<dl.children.length;i+=2)values.set(dl.children[i].textContent,dl.children[i+1].textContent);
   assert.ok([...values.values()].every(v=>v!==''));assert.ok([...values.values()].includes('-'));
   if(!wishlist)assert.ok([...values.values()].some(v=>String(v)==='0'));
  }
  await ui.get('#load-collection').fire('click');await ui.get('#mobile-records').children[0].children.find(n=>n.className==='compact-record').fire('click');
  assert.deepEqual(ui.get('#detail-actions').children.slice(0,2).map(n=>n.textContent),['Удалить','Редактировать']);
  const media=ui.get('#detail-content').children.find(n=>n.className==='detail-media');
  assert.deepEqual(media.children.filter(n=>n.tagName==='BUTTON').slice(0,2).map(n=>n.textContent),['Удалить','Заменить']);
 });
 test(`visual package 1 ${wishlist}/${compact}: Add confirmation hides chooser and retains cover for correction`,async()=>{
  const original=globalThis.FileReader;globalThis.FileReader=class{readAsDataURL(){this.result='data:image/png;base64,dGVzdA==';this.onload();}};
  try{
   const ui=await prototypeUI(async()=>response([]),{wishlist,compact});await ui.get('#add-record').fire('click');
   const {id,coverId,favorite,...draft}=wishlist?wish:record;ui.fill({...draft,...(!wishlist?{purchaseDate:'03.09.2026'}:{})});
   ui.get('#add-cover-file').files=[{type:'image/png',size:100}];await ui.get('#add-cover-file').fire('change');
   await ui.get('#record-form').fire('submit');assert.equal(ui.get('#record-preview').hidden,false);assert.equal(ui.get('#add-cover-controls').hidden,true);assert.equal(ui.get('#add-cover-preview').hidden,false);
   await ui.get('#edit-draft').fire('click');assert.equal(ui.get('#add-cover-controls').hidden,false);assert.equal(ui.get('#add-cover-file').disabled,false);assert.equal(ui.get('#add-cover-preview').hidden,false);
   await ui.get('#cancel-record').fire('click');await ui.get('#add-record').fire('click');assert.equal(ui.get('#add-cover-controls').hidden,false);assert.equal(ui.get('#add-cover-preview').hidden,true);
  }finally{globalThis.FileReader=original;}
 });
 test(`visual package 1 ${wishlist}/${compact}: either cover close discards pending file and late FileReader`,async()=>{
  const original=globalThis.FileReader;let reader;globalThis.FileReader=class{readAsDataURL(){reader=this;}};
  try{
   let writes=0;const source=wishlist?wish:record;const ui=await prototypeUI(async(url,o={})=>{if(o.method)writes++;return response([source]);},{wishlist,compact});
   for(const close of ['cancel-cover','close-cover']){
    ui.run(`coverDialog.open(${JSON.stringify(source)})`);ui.get('#cover-file').files=[{type:'image/png',size:100}];await ui.get('#cover-file').fire('change');
    await ui.get('#'+close).fire('click');reader.result='data:image/png;base64,late';reader.onload();assert.equal(ui.get('#cover-dialog').open,false);assert.equal(ui.get('#cover-preview').hidden,true);
    ui.run(`coverDialog.open(${JSON.stringify(source)})`);assert.equal(ui.get('#save-cover').disabled,true);await ui.get('#save-cover').fire('click');assert.equal(writes,0);await ui.get('#'+close).fire('click');
   }
  }finally{globalThis.FileReader=original;}
 });
}
