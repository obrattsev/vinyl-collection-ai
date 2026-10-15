import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prototypeUI,response,deferred} from './fixtures/prototype-dom.mjs';
import {record} from './fixtures/collection.mjs';
for(const wishlist of [false,true]){
 test(`auth ${wishlist}: initial HTML does not expose an unverified login state`,async()=>{
  const html=await readFile(new URL(wishlist?'../prototype/wishlist.html':'../prototype/index.html',import.meta.url),'utf8');
  for(const id of ['owner-login','owner-logout','account-link'])assert.match(html,new RegExp('<(?:button|a)\\b[^>]*id="'+id+'"[^>]*\\bhidden\\b'));
 });
 test(`auth ${wishlist}: delayed and failed session checks never show login as a fallback`,async()=>{
  const gate=deferred();const ui=await prototypeUI(()=>gate.promise,{wishlist,owner:false,pathname:'/alice/'+(wishlist?'wishlist':'collection')});
  const pending=ui.run('checkSession()');assert.equal(ui.get('#owner-login').hidden,true);
  gate.reject(Error('offline'));await pending;
  for(const id of ['owner-login','owner-logout','account-link'])assert.equal(ui.get('#'+id).hidden,true);
  assert.equal(ui.run('owner'),false);assert.equal(ui.run('csrfToken'),null);
  assert.match(ui.get('#auth-status').textContent,/Не удалось проверить вход/);
 });
 test(`auth ${wishlist}: resolved multiuser session uses account link, legacy guest uses login`,async()=>{
  const ui=await prototypeUI(()=>response([]),{wishlist,owner:false});
  ui.run("applySession({authMode:'multiuser',role:'owner',login:'alice',csrfToken:'csrf'})");
  assert.equal(ui.get('#owner-login').hidden,true);assert.equal(ui.get('#account-link').hidden,false);
  ui.run("applySession({authMode:'legacy',role:'guest'})");assert.equal(ui.get('#owner-login').hidden,false);assert.equal(ui.get('#account-link').hidden,true);
 });
 test(`preview ${wishlist}: empty fields use hyphen and zero remains zero`,async()=>{
  const ui=await prototypeUI(()=>response([]),{wishlist});
  ui.run(`displayRecord(preview,${JSON.stringify({...record,note:null,label:'',purchasePrice:0})})`);
  const nodes=ui.get('#record-preview').children[0].children;
  assert.equal(nodes[nodes.findIndex(n=>n.textContent==='Примечание')+1].textContent,'-');
  assert.equal(nodes[nodes.findIndex(n=>n.textContent==='Лейбл')+1].textContent,'-');
  if(!wishlist)assert.equal(nodes[nodes.findIndex(n=>n.textContent==='Цена покупки (руб.)')+1].textContent,0);
 });
}
