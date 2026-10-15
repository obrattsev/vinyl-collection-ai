import test from 'node:test';
import assert from 'node:assert/strict';
import {GENRES,genresInRecords} from '../src/genres.mjs';
import {prototypeUI,response,deferred} from './fixtures/prototype-dom.mjs';
import {record} from './fixtures/collection.mjs';
import {wish} from './fixtures/wishlist.mjs';
import {publicRecords} from '../src/public-record.mjs';
const options=ui=>ui.get('#search-genre').children.map(n=>n.value);
function rows(wishlist=false){return [['Rock','Jazz'],['Rock','Blues'],[null,null]].map(([genre,additionalGenre],i)=>({...wishlist?wish:record,id:`0000000${i+1}-1111-4111-8111-111111111111`,genre,additionalGenre,artist:'Fixture '+i}));}
test('genre frequencies use primary/additional once per record, normalize known labels and break ties alphabetically',()=>{
 const input=[{genre:' rock ',additionalGenre:'ROCK'},{genre:'Jazz',additionalGenre:'Blues'},{genre:'Rock',additionalGenre:'Jazz'},{genre:'  Legacy   genre ',additionalGenre:null},{genre:null,additionalGenre:''}];
 const copy=structuredClone(input),closed=[...GENRES];
 assert.deepEqual(genresInRecords(input),['Jazz','Rock','Blues','Legacy genre']);
 assert.deepEqual(genresInRecords([...input].reverse()),genresInRecords(input));
 assert.deepEqual(input,copy);assert.deepEqual(GENRES,closed);
 assert.deepEqual(genresInRecords([]),[]);assert.deepEqual(genresInRecords([{genre:'   ',additionalGenre:null}]),[]);
});
for(const wishlist of [false,true])for(const compact of [false,true]){
 test(`genre filter ${wishlist}/${compact}: full list counts, stable selection and unchanged matching/order`,async()=>{
  const current=rows(wishlist),calls=[];const ui=await prototypeUI(async url=>{calls.push(url);return response(current);},{wishlist,compact});
  assert.deepEqual(options(ui),['']);await ui.get('#load-collection').fire('click');assert.deepEqual(options(ui),['','Rock','Blues','Jazz']);
  ui.searchInput('genre').value='Jazz';await ui.get('#search-form').fire('submit');assert.deepEqual(options(ui),['','Rock','Blues','Jazz']);
  assert.equal(ui.get('#search-genre').value,'Jazz');assert.equal(ui.run('displayedRecords.length'),1);
  assert.equal(ui.run('displayedRecords[0].artist'),'Fixture 0');
  assert.ok(calls.every(url=>url===(wishlist?'/api/wishlist':'/api/collection')));
  // Existing substring semantics remain: Rock also matches Hard Rock.
  current.push({...current[0],id:'99999999-1111-4111-8111-111111111111',genre:'Hard Rock',additionalGenre:null,artist:'Earlier'});
  ui.searchInput('genre').value='Rock';await ui.get('#search-form').fire('submit');assert.equal(ui.run('displayedRecords.length'),3);
 });
 test(`genre filter ${wishlist}/${compact}: changed composition, empty and genre-less lists`,async()=>{
  let current=rows(wishlist);const ui=await prototypeUI(async()=>response(current),{wishlist,compact});
  await ui.get('#load-collection').fire('click');ui.searchInput('genre').value='Rock';ui.searchInput('artist').value='Fixture';
  current=current.map(r=>({...r,genre:r.genre==='Rock'?'Soul':r.genre}));
  await ui.get('#search-form').fire('submit');assert.deepEqual(options(ui),['','Soul','Blues','Jazz']);
  assert.equal(ui.get('#search-genre').value,'');assert.equal(ui.run('lastCriteria.genre'),'');assert.equal(ui.run('lastCriteria.artist'),'Fixture');
  assert.equal(ui.run('displayedRecords.length'),3);
  current=current.map(r=>({...r,genre:null,additionalGenre:null}));await ui.get('#load-collection').fire('click');assert.deepEqual(options(ui),['']);
  current=[];await ui.get('#load-collection').fire('click');assert.deepEqual(options(ui),['']);
 });
}
test('failed/private load clears previous options; auth switch and late old response cannot restore private genres',async()=>{
 let mode='initial';const stale=deferred();const ui=await prototypeUI(async()=>mode==='late'?stale.promise:mode==='denied'?{ok:false,json:async()=>({error:'COLLECTION_PRIVATE'})}:response([{...record,genre:mode==='initial'?'Private genre A':'Visible genre B',additionalGenre:null}]),{pathname:'/collection'});
 await ui.run('showCollection()');assert.deepEqual(options(ui),['','Private genre A']);
 mode='late';const loading=ui.run('showCollection()');ui.run("applySession({role:'guest'})");assert.deepEqual(options(ui),['']);
 mode='denied';await ui.run('showCollection()');assert.deepEqual(options(ui),['']);
 ui.run("applySession({role:'owner',csrfToken:'user-b-csrf'})");mode='user-b';await ui.run('showCollection()');assert.deepEqual(options(ui),['','Visible genre B']);
 stale.resolve(response([{...record,genre:'Private genre A',additionalGenre:null}]));await loading;assert.deepEqual(options(ui),['','Visible genre B']);
});
test('public profile filters use only returned public list, without loading current visitor lists',async()=>{
 const calls=[],visible=publicRecords(rows());const ui=await prototypeUI(async url=>{calls.push(url);return response(visible);},{owner:false,pathname:'/public_user/collection'});
 await ui.run('showCollection()');assert.deepEqual(options(ui),['','Rock','Blues','Jazz']);assert.deepEqual(calls,['/api/u/public_user/collection']);
});
test('genre filter updates after Add, Edit and Delete using the fresh current list',async()=>{
 let current=[];const ui=await prototypeUI(async(url,o={})=>{
  if(!o.method)return response(url==='/api/collection'?current:[]);
  if(o.method==='POST'){const created={...record,...JSON.parse(o.body)};current.push(created);return response(created);}
  if(o.method==='PUT'){current=current.map(r=>({...r,...JSON.parse(o.body)}));return response(current[0]);}
  const removed=current[0];current=[];return response(removed);
 });
 await ui.get('#load-collection').fire('click');await ui.get('#add-record').fire('click');
 const {id,coverId,favorite,...draft}=record;ui.fill({...draft,genre:'Soul',additionalGenre:null,purchaseDate:'03.09.2026'});
 await ui.get('#record-form').fire('submit');await ui.get('#confirm-record').fire('click');assert.deepEqual(options(ui),['','Soul']);
 await ui.run(`openEdit(${JSON.stringify({...record,...draft,genre:'Soul',additionalGenre:null})})`);ui.fill({genre:'Blues'});await ui.get('#record-form').fire('submit');await ui.get('#confirm-record').fire('click');assert.deepEqual(options(ui),['','Blues']);
 await ui.run('openDelete(displayedRecords[0])');await ui.get('#confirm-delete').fire('click');assert.deepEqual(options(ui),['']);
});
