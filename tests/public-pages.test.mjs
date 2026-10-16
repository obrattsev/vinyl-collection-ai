import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from '../server/app.mjs';
import {record} from './fixtures/collection.mjs';
import {wish} from './fixtures/wishlist.mjs';
import {OperationError} from '../server/collection-service.mjs';

test('public initial HTML, metadata, canonical, sitemap and privacy across guest/owner/other',async t=>{
 let visible=true,exists=true,sale=false,views=0;
 const factory=Object.assign(()=>({}),{
  publicCollections:async()=>exists&&visible?['alice']:[],
  profile:async(login,section,session)=>{
   if(!exists||login.toLowerCase()!=='alice')throw new OperationError(404,'NOT_FOUND');
   if(!visible&&session?.userId!=='a')throw new OperationError(403,'COLLECTION_PRIVATE');
   return {login:'alice',public:visible,owner:session?.userId==='a',showSalePrice:sale,
    records:async()=>[{...(section==='wishlist'?wish:record),artist:'<script>alert("x")</script>',note:'Literal $& text',salePrice:0}]};
  }
 });
 const app=createApp({}, {servicesForSession:factory,onListView:()=>{views++;},auth:{session:async req=>req.headers.cookie?{userId:req.headers.cookie,login:'alice'}:null,limit(){},checkOrigin(){}}});
 app.listen(0,'127.0.0.1');await once(app,'listening');t.after(()=>new Promise(resolve=>{app.close(resolve);app.closeAllConnections();}));
 const get=(path,options={})=>fetch(`http://127.0.0.1:${app.address().port}`+path,{redirect:'manual',...options});
 for(const cookie of ['', 'a','b']) {
  const res=await get('/alice/collection?utm_source=evil',{headers:{cookie,Host:'evil.example'}}),html=await res.text();
  assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');assert.equal(res.headers.get('x-robots-tag'),'index, follow');
  assert.match(html,/id="public-catalogue"/);assert.ok(html.includes('Literal $&amp; text'));assert.match(html,/&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(html,/<link rel="canonical" href="https:\/\/vinyl-collection.ru\/alice\/collection">/);
  for(const secret of [record.id,record.purchaseStore,record.purchaseDate,'evil.example','utm_source','<script>alert'])assert.ok(!html.includes(secret),secret);
 }
 assert.doesNotMatch(await(await get('/alice/collection')).text(),/<dt>Цена продажи<\/dt>/);
 assert.equal(views,0,'SSR and crawler requests never record activity');
 sale=true;assert.match(await(await get('/alice/collection')).text(),/<dt>Цена продажи<\/dt><dd>0<\/dd>/);
 const head=await get('/alice/collection',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
 const wishlist=await get('/alice/wishlist');assert.equal(wishlist.headers.get('x-robots-tag'),'noindex');assert.match(await wishlist.text(),/Wish-list alice/);
 let xml=await(await get('/sitemap.xml')).text();assert.match(xml,/alice\/collection/);assert.doesNotMatch(xml,/wishlist|auth|api/);
 for(const path of ['/Alice/collection','/u/alice/collection','/alice','/alice/collection/']) {const res=await get(path);assert.equal(res.status,302);assert.equal(res.headers.get('location'),'/alice/collection');}
 visible=false;
 for(const cookie of ['', 'b']) {const res=await get('/alice/collection',{headers:{cookie}});assert.equal(res.status,404);assert.equal(res.headers.get('x-robots-tag'),'noindex');assert.doesNotMatch(await res.text(),/alert|public-catalogue|og:image/);}
 const owner=await get('/alice/collection',{headers:{cookie:'a'}});assert.equal(owner.status,200);assert.equal(owner.headers.get('x-robots-tag'),'noindex');assert.doesNotMatch(await owner.text(),/public-catalogue|og:image|alert\(/);
 assert.doesNotMatch(await(await get('/sitemap.xml')).text(),/alice/);
 exists=false;assert.equal((await get('/alice/collection',{headers:{cookie:'a'}})).status,404);
 for(const path of ['/auth','/unknown/path','/api/no-such-route'])assert.equal((await get(path)).headers.get('x-robots-tag'),'noindex');
 assert.match(await(await get('/robots.txt')).text(),/Sitemap: https:\/\/vinyl-collection.ru\/sitemap.xml/);
 assert.equal((await get('/')).headers.get('x-robots-tag'),'index, follow');
});

test('renderer preserves empty/zero values, escapes metadata and uses public cover URLs only',async()=>{
 const {catalogue,metadata}=await import('../server/public-pages.mjs');
 const {publicRecords}=await import('../src/public-record.mjs');
 const coverId='11111111-1111-4111-8111-111111111111';
 const projection=publicRecords([{...record,coverId,note:null,salePrice:0}],true);
 const html=catalogue(projection);
 assert.match(html,/<dt>Примечание<\/dt><dd>-<\/dd>/);assert.match(html,/<dt>Цена продажи<\/dt><dd>0<\/dd>/);
 assert.match(html,new RegExp('/media/covers/'+coverId+'/thumb.webp'));assert.doesNotMatch(html,new RegExp(record.id));
 assert.match(catalogue([]),/Коллекция пуста/);
 const head=metadata('<head><title>old</title></head>',{title:'"<&',description:'" onload="evil',path:'/alice/collection',image:projection[0].cover.imageUrl,index:true});
 assert.match(head,/&quot; onload=&quot;evil/);assert.doesNotMatch(head,/content="" onload=/);assert.match(head,/og:image/);
 assert.doesNotMatch(metadata('<head><title>old</title></head>',{title:'empty',description:'',path:'/alice/collection'}),/og:image/);
});

test('client replaces initial catalogue after successful loading and removes it on privacy/error response',async()=>{
 const {prototypeUI,response}=await import('./fixtures/prototype-dom.mjs');
 const {publicRecords}=await import('../src/public-record.mjs');
 for(const wishlist of [false,true]) for(const compact of [false,true]) for(const owner of [false,true]) {
  const ui=await prototypeUI(async()=>response(owner?[wishlist?wish:record]:publicRecords([wishlist?wish:record])),{wishlist,compact,owner});
  const initial=ui.get('#public-catalogue');await ui.run('showCollection()');assert.equal(initial.removed,true);
  const blocked=await prototypeUI(async()=>({ok:false,json:async()=>({error:'COLLECTION_PRIVATE'})}),{wishlist,compact,owner});
  const stale=blocked.get('#public-catalogue');await blocked.run('showCollection()');assert.equal(stale.removed,true);assert.equal(blocked.get('#error').hidden,false);
 }
});
