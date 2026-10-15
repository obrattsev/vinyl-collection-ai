import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

async function authUI(search='', handler=async()=>({registrationEnabled:true,csrfToken:'test'})) {
  const elements=new Map(),fields=new Map();let focused,destination;
  const element=key=>{if(!elements.has(key))elements.set(key,{hidden:false,value:'',classList:{toggle(){}},reset(){},querySelector(){return element(key+' input');},addEventListener(type,fn){this[type]=fn;},focus(){focused=key;}});return elements.get(key);};
  for(const name of ['fullName','email','login','password','repeat','code'])fields.set(name,element(name));
  element('#auth-flow').elements={namedItem:name=>fields.get(name)};
  const context=vm.createContext({document:{querySelector:element,querySelectorAll:()=>[element('.account-cancel')]},location:{search,assign:path=>destination=path},sessionStorage:{getItem(){throw Error('Stale storage must not be read');}},localStorage:{getItem(){throw Error('Stale storage must not be read');}},URLSearchParams,AbortController,setTimeout,clearTimeout,setInterval:()=>1,clearInterval(){},
    FormData:class{constructor(form){if(form===element('#account-password'))return ['currentPassword','password','repeat'].map(name=>[name,element('change-'+name).value]);if(form===element('#account-delete'))return [['password',element('delete-password').value]];return [...fields].filter(([,field])=>!field.disabled).map(([name,field])=>[name,field.value]);}},
    fetch:async(url,options)=>{const result=await handler(url,options);return {ok:!result?.error,json:async()=>result};}});
  await vm.runInContext(`(async()=>{${await readFile(new URL('../prototype/auth-ui.mjs',import.meta.url),'utf8')}})()`,context);
  return {element,focused:()=>focused,destination:()=>destination,submit:()=>element('#auth-flow').submit({preventDefault(){}})};
}
for(const direct of [false,true])test(`registration focuses Email from ${direct?'landing':'login'}`,async()=>{
  const ui=await authUI(direct?'?mode=registration':'?mode=login');
  if(!direct)ui.element('#show-register').onclick();
  assert.equal(ui.focused(),'email');
  assert.equal(ui.element('email').required,true);
  assert.equal(ui.element('fullName').required,false);
  ui.element('#show-login').onclick();
  assert.equal(ui.element('#login-label').hidden,false);
  assert.equal(ui.element('#show-register').hidden,false);
  assert.equal(ui.element('#show-forgot').hidden,false);
});

test('login always redirects to the authenticated user Collection URL',async()=>{
 const ui=await authUI('?mode=login',async url=>url.endsWith('/login')?{login:'bob'}:{registrationEnabled:true,csrfToken:'test'});
 ui.element('login').value='bob';ui.element('password').value='fixture password';await ui.submit();
 assert.equal(ui.destination(),'/bob/collection');assert.equal(ui.element('password').value,'');
});
test('registration verifies email, blocks short passwords, then logs in using existing endpoint and redirects',async()=>{
 const calls=[];
 const ui=await authUI('?mode=registration',async(url,options)=>{calls.push({url,body:options?.body?JSON.parse(options.body):null});return url.startsWith('/api/auth/bootstrap')?{registrationEnabled:true,csrfToken:'test'}:url.endsWith('/login')?{login:'alice'}:{state:'completed'};});
 ui.element('email').value='alice@example.test';ui.element('login').value='alice';await ui.submit();
 ui.element('code').value='123456';await ui.submit();
 ui.element('password').value='short';ui.element('repeat').value='short';await ui.submit();
 assert.equal(calls.some(c=>c.url.endsWith('/complete')),false);
 ui.element('password').value='Fixture password 42';ui.element('repeat').value='Fixture password 42';await ui.submit();
 assert.deepEqual(calls.slice(-2).map(c=>c.url),['/api/auth/complete','/api/auth/login']);
 assert.deepEqual(calls.at(-1).body,{login:'alice',password:'Fixture password 42'});
 assert.equal(ui.destination(),'/alice/collection');assert.equal(ui.element('password').value,'');
});

test('guest account offers full login/register, uses server-validated return path, preserves Wishlist context on reload',async()=>{
 for(const returnTo of ['/alice/wishlist','/']){
  const ui=await authUI('?returnTo='+encodeURIComponent(returnTo),async()=>({registrationEnabled:true,csrfToken:'test',returnTo}));
  assert.equal(ui.element('#back-collection').href,returnTo);assert.equal(ui.element('#auth-flow').hidden,true);assert.equal(ui.element('#start-login').hidden,false);assert.equal(ui.element('#start-register').hidden,false);assert.equal(ui.element('#show-register').hidden,true);
  assert.equal(ui.element('#back-collection').hidden,returnTo==='/');
  ui.element('#start-login').onclick();assert.equal(ui.element('#login-label').hidden,false);assert.equal(ui.element('#show-forgot').hidden,false);assert.equal(ui.element('#show-register').hidden,false);
 }
});
test('authenticated account hides signup/login, returns to own Collection, saves settings and logs out to landing',async()=>{
 const calls=[];const ui=await authUI('?returnTo=%2Falice%2Fwishlist',async(url,options)=>{calls.push({url,options});return url.startsWith('/api/auth/bootstrap')?{session:{role:'owner',login:'bob',csrfToken:'session-token'},registrationEnabled:true}:url==='/api/auth/account'?{login:'bob',publicCollection:false,showSalePrice:true,canDelete:true}:{state:'saved'};});
 assert.equal(ui.element('#back-collection').href,'/bob/collection');assert.equal(ui.element('#show-register').hidden,true);assert.equal(ui.element('#start-login').hidden,true);assert.equal(ui.element('#account-settings').hidden,false);
 ui.element('#public-collection').checked=true;await ui.element('#public-collection').onchange();
 assert.deepEqual(JSON.parse(calls.at(-1).options.body),{publicCollection:true,showSalePrice:true});assert.equal(calls.at(-1).options.headers['X-CSRF-Token'],'session-token');
 ui.element('#delete-account').onclick();assert.equal(ui.element('#account-delete').hidden,false);ui.element('.account-cancel').onclick();assert.equal(ui.element('#account-delete').hidden,true);assert.equal(calls.some(c=>c.url.endsWith('/delete-account')),false);
 await ui.element('#account-logout').onclick();assert.equal(calls.at(-1).url,'/api/auth/logout');assert.equal(ui.destination(),'/');
});

import {prototypeUI,response} from './fixtures/prototype-dom.mjs';
import {record} from './fixtures/collection.mjs';
import {publicRecords} from '../src/public-record.mjs';
for(const section of ['collection','wishlist'])test(`profile ${section} has account link with explicit return context for guests and owners`,async()=>{
 const ui=await prototypeUI(async()=>response([]),{owner:false,pathname:`/alice/${section}`,wishlist:section==='wishlist'});
 for(const session of [{role:'guest',authMode:'multiuser'},{role:'owner',login:'alice',csrfToken:'token',authMode:'multiuser'}]){
  ui.run(`applySession(${JSON.stringify(session)})`);
  assert.equal(ui.get('#owner-login').hidden,true);assert.equal(ui.get('#owner-logout').hidden,true);assert.equal(ui.get('#account-link').hidden,false);assert.equal(ui.get('#account-link').href,'/auth?returnTo='+encodeURIComponent(`/alice/${section}`));
 }
});
test('sale price editing can clear an existing value; zero renders in guest details and CSV without purchase data',async()=>{
 const priced={...record,salePrice:0};
 const ui=await prototypeUI(async()=>response([priced]));ui.run("applySession({role:'owner',csrfToken:'token',authMode:'multiuser'})");
 await ui.run(`openEdit(${JSON.stringify(priced)})`);ui.input('salePrice').value='';
 assert.equal(ui.run('readDraft().salePrice'),null);
 const projected=publicRecords([priced],true);ui.run("applySession({role:'guest',authMode:'multiuser'})");
 ui.run(`displayedRecords=${JSON.stringify(projected)};renderRecords(displayedRecords);displayRecord(document.querySelector('#detail-content'),displayedRecords[0],Object.fromEntries(PUBLIC_FIELDS.map(field=>[field,labels[field]])));`);
 assert.equal(ui.get('#heading-salePrice').hidden,false);
 const texts=ui.get('#detail-content').children[0].children.map(x=>x.textContent);assert.ok(texts.includes('Цена продажи (руб.)'));assert.ok(!texts.includes('Цена покупки (руб.)'));
 assert.equal(projected[0].salePrice,0);assert.equal(projected[0].purchasePrice,undefined);
});

test('back link requires current profile context, ignores stored context and uses safe server fallback',async()=>{
 for(const mode of ['', '?mode=login','?mode=registration']){
  const ui=await authUI(mode,async()=>({registrationEnabled:true,returnTo:'/'}));
  assert.equal(ui.element('#back-collection').hidden,true);
 }
 for(const section of ['collection','wishlist'])for(const destination of [`/alice/${section}`,'/']){
  const ui=await authUI('?returnTo='+encodeURIComponent(`/alice/${section}`),async()=>({registrationEnabled:true,returnTo:destination}));
  assert.equal(ui.element('#back-collection').hidden,false);
  assert.equal(ui.element('#back-collection').href,destination);
  ui.element('#start-register').onclick();assert.equal(ui.focused(),'email');
 }
});
test('deletion sends explicit confirmation and session CSRF, preserves failures and blocks repeated pending submission',async()=>{
 let finish;const calls=[];
 const ui=await authUI('',async(url,options)=>{
  if(url.startsWith('/api/auth/bootstrap'))return {session:{role:'owner',csrfToken:'session-token'}};
  if(url==='/api/auth/account')return {login:'bob',canDelete:true};
  calls.push({url,options});await new Promise(resolve=>finish=resolve);return {error:'INVALID_CURRENT_PASSWORD'};
 });
 ui.element('delete-password').value='wrong password';
 const pending=ui.element('#account-delete').onsubmit({preventDefault(){}});
 await ui.element('#account-delete').onsubmit({preventDefault(){}});
 assert.equal(calls.length,1);
 assert.deepEqual(JSON.parse(calls[0].options.body),{password:'wrong password',confirm:true});
 assert.equal(calls[0].options.headers['X-CSRF-Token'],'session-token');
 finish();await pending;assert.equal(ui.destination(),undefined);
 assert.equal(ui.element('#auth-message').textContent,'Текущий пароль неверен.');
});
test('deletion markup keeps required password, exact warning and reusable danger buttons without checkbox',async()=>{
 const html=await readFile(new URL('../prototype/auth.html',import.meta.url),'utf8');
 const deletion=html.split('<form id="account-delete"')[1];
 assert.ok(deletion.includes('<p>Удаление необратимо. Будут удалены аккаунт и коллекция. Восстановить данные нельзя. Логин останется зарезервированным.</p>'));
 assert.match(deletion,/name="password"[^>]*required/);assert.doesNotMatch(deletion,/type="checkbox"/);
 assert.match(html,/id="delete-account" class="button-danger"/);
 assert.match(deletion,/class="button-danger" type="submit">Удалить навсегда/);
 assert.match(html,/id="welcome-actions" class="landing-actions"/);
});


test('active session entering login from landing goes directly to own Collection, guest still sees full login',async()=>{
 const calls=[];
 const ui=await authUI('?mode=login',async url=>{calls.push(url);return {session:{role:'owner',login:'bob'},registrationEnabled:true};});
 assert.equal(ui.destination(),'/bob/collection');assert.equal(calls.includes('/api/auth/account'),false);
 const guest=await authUI('?mode=login');assert.equal(guest.destination(),undefined);
 assert.equal(guest.element('#login-label').hidden,false);assert.equal(guest.element('#password-label').hidden,false);assert.equal(guest.element('#show-forgot').hidden,false);
});

test('mail request waits, prevents double clicks and confirms request rather than delivery',async()=>{
 let release,requests=0;
 const ui=await authUI('?mode=registration',async(url)=>{
  if(url.startsWith('/api/auth/bootstrap'))return {registrationEnabled:true,csrfToken:'test'};
  requests++;await new Promise(resolve=>release=resolve);return {state:'pending'};
 });
 ui.element('email').value='alice@example.test';ui.element('login').value='alice';
 const first=ui.submit();await Promise.resolve();await ui.submit();
 assert.equal(requests,1);assert.equal(ui.element('#auth-submit').disabled,true);
 assert.match(ui.element('#auth-message').textContent,/Проверяем/);
 release();await first;
 assert.match(ui.element('#auth-message').textContent,/Запрос принят/);
 assert.match(ui.element('#auth-message').textContent,/Доставка пока не подтверждена/);
 assert.doesNotMatch(ui.element('#auth-message').textContent,/мы отправили/);
});
test('mail network timeout hides technical details and blocks immediate retry',async()=>{
 let requests=0;
 const ui=await authUI('?mode=registration',async(url)=>{
  if(url.startsWith('/api/auth/bootstrap'))return {registrationEnabled:true,csrfToken:'test'};
  requests++;throw Error('SMTP 535 secret credentials');
 });
 await ui.submit();assert.match(ui.element('#auth-message').textContent,/Запрос мог быть обработан/);
 assert.doesNotMatch(ui.element('#auth-message').textContent,/535|secret|credentials/);
 await ui.submit();assert.equal(requests,1);
});
test('SMTP service rejection displays safe message and preserves the input form',async()=>{
 const ui=await authUI('?mode=registration',async url=>url.startsWith('/api/auth/bootstrap')?{registrationEnabled:true,csrfToken:'test'}:{error:'MAIL_UNAVAILABLE'});
 await ui.submit();
 assert.equal(ui.element('#auth-message').textContent,'Сервис писем временно недоступен. Попробуйте позже.');
 assert.equal(ui.element('#email-label').hidden,false);assert.equal(ui.element('#code-label').hidden,true);
});

for(const canDelete of [false,true])test(`account deletion affordance follows server protection ${canDelete}`,async()=>{
 const ui=await authUI('',async url=>url.includes('/bootstrap?')?{session:{role:'owner',csrfToken:'token'}}:{login:'fixture',canDelete,legacy:false,canChangePassword:true});
 assert.equal(ui.element('#delete-account').hidden,!canDelete);assert.equal(ui.element('#delete-account').disabled,!canDelete);
 assert.equal(ui.element('#account-protected').hidden,canDelete);
 const html=await readFile(new URL('../prototype/auth.html',import.meta.url),'utf8');assert.match(html,/Удаление аккаунта владельца сайта недоступно, поскольку он связан с настройками сервиса и синхронизацией данных/);
});
