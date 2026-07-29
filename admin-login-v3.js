(function(){
  const form=document.getElementById('loginForm');
  const error=document.getElementById('loginError');
  if(!form||form.dataset.cloudLoginFix==='1')return;
  form.dataset.cloudLoginFix='1';

  const SUPABASE_URL='https://qquvbedufztponyxneqa.supabase.co';
  const SUPABASE_KEY='sb_publishable_8lZ9AfMvjZOx1Xz6JTlNFg_uKK0qjr8';
  const REST_URL=SUPABASE_URL+'/rest/v1/taxichi_pro_dispatchers?select=*&active=eq.true&order=created_at.asc';
  const AUTH_URL=SUPABASE_URL+'/functions/v1/taxichi-auth';
  const HEADERS={apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY,'Accept-Profile':'public','Content-Profile':'public'};

  const params=new URLSearchParams(location.search);
  if(params.get('reset')==='1'){
    sessionStorage.clear();
    localStorage.removeItem('taxichiDispatcherRemember');
    localStorage.removeItem('taxichiDispatcherRememberV2');
    localStorage.removeItem('taxichiDispatcherLastAdmin');
    location.replace(location.pathname);
    return;
  }

  const clearKnownAutofill=()=>{
    const login=form.elements.login;
    const password=form.elements.password;
    if(document.activeElement===login||document.activeElement===password)return;
    const value=String(login?.value||'').trim().toLowerCase();
    if(value==='baratov329@mail.ru'||value==='farhodzhon'||value==='admin'){
      login.value='';
      if(password)password.value='';
    }
  };
  clearKnownAutofill();
  [250,800,1600].forEach(ms=>setTimeout(clearKnownAutofill,ms));

  function setError(text){if(error)error.textContent=text}
  function clean(value){return String(value||'').trim()}
  function digits(value){return String(value||'').replace(/\D/g,'')}
  async function fetchWithTimeout(url,options={},timeoutMs=10000){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{return await fetch(url,{...options,signal:controller.signal,cache:'no-store'})}
    finally{clearTimeout(timer)}
  }

  async function fastLogin(data){
    const response=await fetchWithTimeout(REST_URL,{headers:HEADERS},10000);
    if(!response.ok)throw Object.assign(new Error('rest_failed'),{status:response.status});
    const rows=await response.json();
    const login=clean(data.login);
    const loginLower=login.toLowerCase();
    const loginDigits=digits(login);
    const account=(rows||[]).find(row=>
      String(row.id||'')!=='demo' &&
      String(row.name||'')!=='Иванова Мария' &&
      String(row.login||'')!=='admin' &&
      (clean(row.login).toLowerCase()===loginLower || (loginDigits && digits(row.phone)===loginDigits)) &&
      String(row.password||'')===String(data.password||'')
    );
    if(!account)throw Object.assign(new Error('bad_credentials'),{status:401});
    return account;
  }

  function warmServerAuth(data){
    fetch(AUTH_URL,{
      method:'POST',
      headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({action:'adminLogin',login:data.login,password:data.password})
    }).then(r=>r.json().catch(()=>({}))).then(result=>{
      if(result?.sessionToken)sessionStorage.setItem('taxichiAdminSessionToken',result.sessionToken);
    }).catch(err=>console.warn('background server auth skipped',err));
  }

  form.addEventListener('submit',async event=>{
    event.preventDefault();
    event.stopImmediatePropagation();
    const button=form.querySelector('button[type="submit"],button:not([type])');
    const oldText=button?button.textContent:'';
    if(button){button.disabled=true;button.textContent='Проверяем...'}
    setError('');
    try{
      const data=Object.fromEntries(new FormData(form));
      const account=await fastLogin(data);
      const id=account.id||'';
      sessionStorage.setItem('taxichiDispatcherSession',id);
      localStorage.removeItem('taxichiDispatcherRemember');
      localStorage.removeItem('taxichiDispatcherLastAdmin');
      if(data.remember)localStorage.setItem('taxichiDispatcherRememberV2',id);
      else localStorage.removeItem('taxichiDispatcherRememberV2');
      warmServerAuth(data);
      location.href=`${location.pathname}?admin=${encodeURIComponent(id)}`;
    }catch(err){
      console.warn('admin login failed',err);
      if(err.status===401)setError('Логин или пароль неверно, обратитесь в поддержку');
      else setError('Сервер не отвечает. Проверьте интернет и откройте https://admin.taxichi.pro/?reset=1');
    }finally{
      if(button){button.disabled=false;button.textContent=oldText||'Войти'}
    }
  },true);
})();
