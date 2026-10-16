const form=document.querySelector('#auth-flow'),message=document.querySelector('#auth-message'),submit=document.querySelector('#auth-submit');
let stage='login',kind='registration',csrf='',config={},busy=false,registrationLogin='',timer;
const field=name=>form.elements.namedItem(name);
const button=id=>document.querySelector('#'+id);
const errors={MAIL_UNAVAILABLE:'Сервис писем временно недоступен. Попробуйте позже.',DELETION_SAFETY_UNAVAILABLE:'Сервис временно недоступен. Попробуйте позже.',OWNER_BRIDGE_ACTIVE:'Смена пароля станет доступна после завершения настройки входа владельца.',AUTH_REQUIRED:'Сеанс завершён. Обновите страницу и войдите снова.',INVALID_CURRENT_PASSWORD:'Текущий пароль неверен.',AUTH_CHANGED:'Состояние аккаунта изменилось. Войдите снова.',ACCOUNT_PROTECTED:'Удаление этого аккаунта недоступно.',ACTIVATION_REQUIRED:'Сначала активируйте новый вход.',CONFIRMATION_REQUIRED:'Подтвердите окончательное удаление.',LOGIN_TAKEN:'Этот логин занят. Выберите другой.',INVALID_INPUT:'Проверьте введённые данные.',PASSWORD_MISMATCH:'Пароли должны совпадать.',COMMON_PASSWORD:'Выберите менее распространённый пароль.',INVALID_PASSWORD:'Пароль должен содержать от 12 до 128 символов.',INVALID_CREDENTIALS:'Неверный логин или пароль.',INVALID_CODE:'Код неверен или больше не действует.',FLOW_EXPIRED:'Время истекло. Начните заново.',RATE_LIMITED:'Слишком много попыток. Повторите позже.',AUTH_BUSY:'Сервис занят. Повторите немного позже.',ALREADY_ACTIVATED:'Новый вход уже активирован. Войдите по логину и новому паролю.',REGISTRATION_UNAVAILABLE:'Не удалось завершить регистрацию. Попробуйте восстановление доступа.',REGISTRATION_DISABLED:'Регистрация пока закрыта.'};
function show(next) {
  stage=next;message.textContent='';
  form.hidden=['welcome','account'].includes(stage);
  button('welcome-actions').hidden=stage!=='welcome';
  button('start-login').hidden=stage!=='welcome';
  button('start-register').hidden=stage!=='welcome'||!config.registrationEnabled;
  button('account-settings').hidden=stage!=='account';
  button('account-password').hidden=button('account-delete').hidden=true;
  const fields={welcome:[],account:[],login:['login','password'],legacy:['password'],registration:['email','login','fullName'],forgot:['email'],verify:['code'],password:kind==='registration'?['login','password','repeat']:['password','repeat']}[stage];
  for(const name of ['fullName','email','login','code','password','repeat']){
    const label=button((name==='fullName'?'name':name)+'-label'),visible=fields.includes(name);
    label.hidden=!visible;field(name).disabled=!visible;field(name).required=visible&&name!=='fullName';
  }
  field('password').value='';field('repeat').value='';field('code').value='';
  field('password').autocomplete=stage==='password'?'new-password':'current-password';
  if(stage==='password'&&kind==='registration')field('login').value=registrationLogin;
  button('password-error').hidden=true;
  const titles={welcome:'Личный кабинет',account:'Личный кабинет',login:'Вход',legacy:'Проверка прежнего входа владельца',registration:'Регистрация',forgot:'Восстановление пароля',verify:'Введите код из письма',password:'Установите пароль'};
  button('auth-title').textContent=titles[stage];submit.textContent=['login','legacy'].includes(stage)?'Войти':stage==='password'?'Сохранить':stage==='forgot'?'Восстановить пароль':'Продолжить';
  submit.classList.toggle('auth-primary',stage==='login'||stage==='legacy');
  for(const id of ['show-register','show-forgot','show-login','resend','activate-owner'])button(id).classList.toggle('auth-primary',id==='show-register');
  button('show-register').hidden=stage!=='login'||!config.registrationEnabled;
  button('show-forgot').hidden=stage!=='login';button('show-login').hidden=['welcome','login','account'].includes(stage);
  button('activate-owner').hidden=stage!=='account'||!config.session?.legacy;
  button('resend').hidden=stage!=='verify';
  if(fields.length)field(fields[0]).focus();
}
const mailRequestAccepted='Запрос принят. Если адрес подходит для этого действия, ожидайте письмо с кодом. Доставка пока не подтверждена. Проверьте папку «Спам»; если письма нет, повторите запрос после окончания таймера.';
let mailRetryAt=0;
async function request(action,body={},token=csrf) {
  const mailAction=['registration','forgot','owner-activate','resend'].includes(action);
  if(mailAction&&Date.now()<mailRetryAt)throw Error('Подождите минуту перед повторным запросом.');
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
  if(mailAction)message.textContent='Проверяем доступность сервиса писем…';
  let response,data;
  try {
    response=await fetch('/api/auth/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify(body),cache:'no-store',signal:controller.signal});
    data=await response.json();
  } catch {
    if(mailAction){mailRetryAt=Date.now()+60000;countdown();}
    throw Error('Не удалось получить ответ. Запрос мог быть обработан. Подождите минуту перед повторной попыткой.');
  } finally {clearTimeout(timeout);}
  if(!response.ok)throw Error(errors[data.error]||'Действие не выполнено. Попробуйте позже.');return data;
}
function countdown(seconds=60){clearInterval(timer);let until=Date.now()+seconds*1000;const update=()=>{const left=Math.max(0,Math.ceil((until-Date.now())/1000));button('resend').disabled=busy||left>0;button('resend').textContent=left?`Повторная отправка через ${left} сек.`:'Отправить код снова';if(!left)clearInterval(timer);};update();timer=setInterval(update,1000);}
async function act(work){if(busy)return;busy=true;submit.disabled=true;message.textContent='';try{await work();}catch(error){message.textContent=error.message;}finally{busy=false;submit.disabled=false;}}
form.addEventListener('submit',event=>{event.preventDefault();return act(async()=>{
  const data=Object.fromEntries(new FormData(form));
  if(stage==='password'&&[...data.password].length<12){button('password-error').hidden=false;field('password').focus();return;}
  if(stage==='login'||stage==='legacy'){const action=stage==='legacy'?'legacy-login':'login';let session;try{session=await request(action,data);}finally{field('password').value='';}location.assign(session.login ? `/${encodeURIComponent(session.login)}/collection` : '/collection');return;}
  if(stage==='registration'||stage==='forgot'){kind=stage==='registration'?'registration':'reset';registrationLogin=data.login||'';await request(stage==='registration'?'registration':'forgot',data);show('verify');message.textContent=mailRequestAccepted;countdown();return;}
  if(stage==='verify'){await request('verify',data);show('password');return;}
  try{await request('complete',data);if(kind==='registration'){show('login');const session=await request('login',{login:data.login,password:data.password});location.assign(`/${encodeURIComponent(session.login)}/collection`);return;}show('login');message.textContent='Пароль сохранён. Войдите с логином и новым паролем.';}finally{field('password').value='';field('repeat').value='';}
});});
field('password').addEventListener('input',()=>{if([...field('password').value].length>=12)button('password-error').hidden=true;});
button('show-register').onclick=()=>{if(!busy)show('registration');};button('show-forgot').onclick=()=>{if(!busy)show('forgot');};button('show-login').onclick=()=>{if(!busy)show('login');};
button('resend').onclick=()=>act(async()=>{await request('resend');message.textContent=mailRequestAccepted;countdown();});
button('activate-owner').onclick=()=>act(async()=>{await request('owner-activate',{},config.session.csrfToken);kind='owner';show('verify');message.textContent=mailRequestAccepted;countdown();});
submit.disabled=true;
try{const returnTo=new URLSearchParams(location.search).get('returnTo')||'/';const response=await fetch('/api/auth/bootstrap?returnTo='+encodeURIComponent(returnTo),{cache:'no-store'});if(!response.ok)throw Error();config=await response.json();csrf=config.csrfToken;button('back-collection').href=config.returnTo||'/';button('back-collection').hidden=!/^\/[^/]+\/(collection|wishlist)$/.test(returnTo);show('welcome');submit.disabled=false;const mode=new URLSearchParams(location.search).get('mode');if(config.session?.role==='owner'){if(mode==='login'&&config.session.login)location.assign(`/${encodeURIComponent(config.session.login)}/collection`);else await account();}else if(mode==='login')show('login');else if(mode==='registration'&&config.registrationEnabled)show('registration');else if(mode==='legacy-owner'&&config.legacyEnabled)show('legacy');}catch{message.textContent='Не удалось подготовить безопасный вход. Обновите страницу.';}

button('start-login').onclick=()=>{if(!busy)show('login');};
button('start-register').onclick=()=>{if(!busy)show('registration');};
async function account(){
 const response=await fetch('/api/auth/account',{cache:'no-store'});
 if(!response.ok){location.assign('/auth');return;}
 const data=await response.json();show('account');
 button('account-login').textContent=data.login;
 button('public-collection').checked=data.publicCollection;
 button('show-sale-price').checked=data.showSalePrice;
 button('delete-account').hidden=!data.canDelete;
 button('delete-account').disabled=!data.canDelete;
 button('account-protected').hidden=data.canDelete;
 button('change-password').disabled=data.legacy||data.canChangePassword===false;
 button('password-unavailable').hidden=!button('change-password').disabled;
 button('back-collection').href=`/${encodeURIComponent(data.login)}/collection`;
}
for(const id of ['public-collection','show-sale-price'])button(id).onchange=()=>act(async()=>{
 button('public-collection').disabled=button('show-sale-price').disabled=true;
 try{await request('settings',{publicCollection:button('public-collection').checked,showSalePrice:button('show-sale-price').checked},config.session.csrfToken);message.textContent='Настройки сохранены.';}
 catch(error){await account();throw error;}
 finally{button('public-collection').disabled=button('show-sale-price').disabled=false;}
});
function accountForm(id){if(busy)return;button('account-password').reset();button('account-delete').reset();button('account-settings').hidden=true;button(id).hidden=false;message.textContent='';button(id).querySelector('input').focus();}
button('change-password').onclick=()=>accountForm('account-password');
button('delete-account').onclick=()=>{if(!button('delete-account').disabled)accountForm('account-delete');};
for(const cancel of document.querySelectorAll('.account-cancel'))cancel.onclick=()=>{if(!busy){button('account-password').reset();button('account-delete').reset();show('account');}};
button('account-password').onsubmit=event=>{event.preventDefault();return act(async()=>{
 const data=Object.fromEntries(new FormData(button('account-password')));
 try{config.session=await request('change-password',data,config.session.csrfToken);show('account');message.textContent='Пароль изменён. Другие сеансы завершены.';}finally{button('account-password').reset();}
});};
button('account-delete').onsubmit=event=>{event.preventDefault();return act(async()=>{
 const data=Object.fromEntries(new FormData(button('account-delete')));
 try{await request('delete-account',{password:data.password,confirm:true},config.session.csrfToken);location.assign('/');}finally{button('account-delete').reset();}
});};
button('account-logout').onclick=()=>act(async()=>{await request('logout',{},config.session.csrfToken);config.session=null;location.assign('/');});
