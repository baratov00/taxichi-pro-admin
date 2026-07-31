(function(){
  const form=document.getElementById('loginForm');
  const error=document.getElementById('loginError');
  if(!form||form.dataset.cloudLoginFix==='1')return;
  form.dataset.cloudLoginFix='1';
  form.setAttribute('autocomplete','off');

  const API_AUTH_URL='https://api.taxichi.pro/auth/admin/login';
  const SUPABASE_URL='https://qquvbedufztponyxneqa.supabase.co';
  const SUPABASE_KEY='sb_publishable_8lZ9AfMvjZOx1Xz6JTlNFg_uKK0qjr8';
  const REST_URL=SUPABASE_URL+'/rest/v1/taxichi_pro_dispatchers?select=*&active=eq.true&order=created_at.asc';
  const HEADERS={apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY,'Accept-Profile':'public','Content-Profile':'public'};

  const loginInput=form.elements.login;
  const passwordInput=form.elements.password;
  [loginInput,passwordInput].forEach(input=>{
    if(!input)return;
    input.setAttribute('autocomplete','new-password');
    input.setAttribute('autocorrect','off');
    input.setAttribute('autocapitalize','none');
    input.setAttribute('spellcheck','false');
    input.setAttribute('data-lpignore','true');
    input.setAttribute('data-1p-ignore','true');
  });

  const params=new URLSearchParams(location.search);
  if(params.get('reset')==='1'){
    sessionStorage.clear();
    localStorage.removeItem('taxichiDispatcherRemember');
    localStorage.removeItem('taxichiDispatcherRememberV2');
    localStorage.removeItem('taxichiDispatcherLastAdmin');
    params.delete('reset');
    params.delete('admin');
    location.replace(`${location.pathname}${params.toString()?`?${params.toString()}`:''}`);
    return;
  }

  function setError(text){if(error)error.textContent=text}
  function clean(value){return String(value||'').trim()}
  function digits(value){return String(value||'').replace(/\D/g,'')}
  function errorCode(err){
    if(err?.status)return `HTTP ${err.status}`;
    if(err?.name==='AbortError')return 'TIMEOUT';
    if(String(err?.message||'').includes('Failed to fetch'))return 'NETWORK';
    return err?.message||'UNKNOWN';
  }
  function removed(row){
    return String(row?.id||'')==='demo'||String(row?.login||'')==='admin'||String(row?.name||'')==='Иванова Мария';
  }
  function match(row,login){
    const value=clean(login);
    const phone=digits(value);
    return clean(row.login).toLowerCase()===value.toLowerCase()||(phone&&digits(row.phone)===phone);
  }

  async function fetchWithTimeout(url,options={},timeoutMs=15000){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{return await fetch(url,{...options,signal:controller.signal,cache:'no-store'})}
    finally{clearTimeout(timer)}
  }

  async function loginViaApi(data){
    const response=await fetchWithTimeout(API_AUTH_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({login:data.login,password:data.password})
    },15000);
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(result.error||'auth_failed'),{status:response.status,result});
    if(!result?.account?.id)throw new Error('bad_auth_response');
    sessionStorage.setItem('taxichiAdminSessionToken',result.sessionToken||'');
    return result.account;
  }

  async function loginFallback(data){
    const response=await fetchWithTimeout(REST_URL,{headers:HEADERS},12000);
    if(!response.ok)throw Object.assign(new Error(await response.text()),{status:response.status});
    const rows=await response.json();
    const account=(rows||[]).filter(x=>!removed(x)).find(x=>match(x,data.login)&&String(x.password||'')===String(data.password||''));
    if(!account)throw Object.assign(new Error('bad_credentials'),{status:401});
    return account;
  }

  function clearOldAutofill(){
    if(document.activeElement===loginInput||document.activeElement===passwordInput)return;
    const value=clean(loginInput?.value).toLowerCase();
    if(value==='baratov329@mail.ru'||value==='admin'||value.includes('@mail.ru')){
      loginInput.value='';
      if(passwordInput)passwordInput.value='';
    }
  }
  clearOldAutofill();
  [300,900,1800].forEach(ms=>setTimeout(clearOldAutofill,ms));

  form.addEventListener('submit',async event=>{
    event.preventDefault();
    event.stopImmediatePropagation();
    const button=form.querySelector('button[type="submit"],button:not([type])');
    const oldText=button?button.textContent:'';
    if(button){button.disabled=true;button.textContent='Проверяем...'}
    setError('');
    try{
      const data=Object.fromEntries(new FormData(form));
      let account;
      try{
        account=await loginViaApi(data);
      }catch(apiError){
        if(apiError.status===401)throw apiError;
        console.warn('api admin login failed, trying fallback',apiError);
        account=await loginFallback(data);
      }
      const id=account.id||'';
      sessionStorage.setItem('taxichiDispatcherSession',id);
      localStorage.removeItem('taxichiDispatcherRemember');
      localStorage.removeItem('taxichiDispatcherLastAdmin');
      if(data.remember)localStorage.setItem('taxichiDispatcherRememberV2',id);
      else localStorage.removeItem('taxichiDispatcherRememberV2');
      location.href=`${location.pathname}?admin=${encodeURIComponent(id)}`;
    }catch(err){
      console.warn('admin login failed',err);
      if(err.status===401)setError('Логин или пароль неверно, обратитесь в поддержку');
      else setError(`Сервер не отвечает (${errorCode(err)}). Откройте https://admin.taxichi.pro/?reset=1 и попробуйте ещё раз.`);
    }finally{
      if(button){button.disabled=false;button.textContent=oldText||'Войти'}
    }
  },true);
})();
