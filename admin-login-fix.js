(function(){
  const form=document.getElementById('loginForm');
  const error=document.getElementById('loginError');
  if(!form||form.dataset.cloudLoginFix==='1')return;
  form.dataset.cloudLoginFix='1';

  const SUPABASE_URL='https://qquvbedufztponyxneqa.supabase.co';
  const SUPABASE_KEY='sb_publishable_8lZ9AfMvjZOx1Xz6JTlNFg_uKK0qjr8';
  const API_BASE=SUPABASE_URL+'/rest/v1';
  const AUTH_URL=SUPABASE_URL+'/functions/v1/taxichi-auth';
  const API_HEADERS={apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY,'Accept-Profile':'public','Content-Profile':'public'};

  const phoneDigits=value=>String(value||'').replace(/\D/g,'');
  const clean=value=>String(value||'').trim();
  const removed=d=>String(d?.id||'')==='demo'||String(d?.name||'')==='Иванова Мария'||String(d?.login||'')==='admin';
  const match=(account,login)=>clean(account.login)===clean(login)||(phoneDigits(login)&&phoneDigits(account.phone)===phoneDigits(login));

  const params=new URLSearchParams(location.search);
  if(params.get('reset')==='1'){
    sessionStorage.removeItem('taxichiDispatcherSession');
    sessionStorage.removeItem('taxichiAdminSessionToken');
    sessionStorage.removeItem('taxichiDirectorViewToken');
    sessionStorage.removeItem('taxichiDirectorViewMode');
    localStorage.removeItem('taxichiDispatcherRemember');
    localStorage.removeItem('taxichiDispatcherLastAdmin');
    params.delete('admin');
    params.delete('directorView');
    params.delete('directorViewReady');
    params.delete('reset');
    location.replace(`${location.pathname}${params.toString()?`?${params.toString()}`:''}`);
    return;
  }

  const directorViewToken=params.get('directorView')||'';
  const adminId=params.get('admin')||'';
  if(directorViewToken&&adminId)validateDirectorView(adminId,directorViewToken);

  function setError(text){if(error)error.textContent=text}
  function settings(value){
    if(!value)return {};
    if(typeof value==='string'){try{return JSON.parse(value)}catch{return {}}}
    return value||{};
  }
  function errorCode(err){
    if(err?.status)return `HTTP ${err.status}`;
    if(err?.name==='AbortError')return 'TIMEOUT';
    if(String(err?.message||'').includes('Failed to fetch'))return 'NETWORK';
    return err?.message||'UNKNOWN';
  }

  async function fetchWithTimeout(url,options={},timeoutMs=12000){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      return await fetch(url,{...options,signal:controller.signal,cache:'no-store'});
    }finally{
      clearTimeout(timer);
    }
  }

  async function serverAuth(action,payload){
    const response=await fetchWithTimeout(AUTH_URL,{
      method:'POST',
      headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({action,...payload})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(result.error||'auth_failed'),{status:response.status,result});
    return result;
  }

  async function fetchDispatchersFallback(){
    const response=await fetchWithTimeout(`${API_BASE}/taxichi_pro_dispatchers?select=*&order=created_at.asc`,{headers:API_HEADERS});
    if(!response.ok)throw Object.assign(new Error(await response.text()),{status:response.status});
    return (await response.json()).filter(d=>!removed(d)&&d.active!==false);
  }

  async function validateDirectorView(id,token){
    try{
      const response=await fetchWithTimeout(`${API_BASE}/taxichi_pro_dispatchers?select=id,payment_settings&id=eq.${encodeURIComponent(id)}&limit=1`,{headers:API_HEADERS});
      if(!response.ok)throw Object.assign(new Error(await response.text()),{status:response.status});
      const row=(await response.json())[0]||null;
      const view=settings(row?.payment_settings).directorView||{};
      const ok=view.token===token&&(Date.parse(view.expiresAt||'')||0)>Date.now();
      if(!ok)throw new Error('bad_director_view_token');
      sessionStorage.setItem('taxichiDispatcherSession',id);
      sessionStorage.setItem('taxichiDirectorViewToken',token);
      sessionStorage.setItem('taxichiDirectorViewMode','1');
      document.body.classList.add('director-view-mode');
      if(!new URLSearchParams(location.search).get('directorViewReady')){
        params.set('directorViewReady','1');
        location.replace(`${location.pathname}?${params.toString()}`);
      }
    }catch(err){
      console.warn('director view validation failed',err);
      sessionStorage.removeItem('taxichiDispatcherSession');
      sessionStorage.removeItem('taxichiDirectorViewToken');
      sessionStorage.removeItem('taxichiDirectorViewMode');
      setError('Временный доступ директора истёк. Откройте кабинет заново из директорского.');
      document.getElementById('loginScreen')?.classList.remove('hidden');
    }
  }

  async function loginViaServer(data){
    const result=await serverAuth('adminLogin',{login:data.login,password:data.password});
    if(!result?.account?.id)throw new Error('bad_auth_response');
    sessionStorage.setItem('taxichiAdminSessionToken',result.sessionToken||'');
    return result.account;
  }

  async function loginFallback(data){
    const account=(await fetchDispatchersFallback()).find(x=>match(x,data.login)&&String(x.password||'')===String(data.password||''));
    if(!account)throw Object.assign(new Error('bad_credentials'),{status:401});
    return account;
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
      let account;
      try{
        account=await loginViaServer(data);
      }catch(serverError){
        if(serverError.status===401)throw serverError;
        console.warn('server admin login failed, trying temporary fallback',serverError);
        account=await loginFallback(data);
      }
      const id=account.id||'';
      sessionStorage.setItem('taxichiDispatcherSession',id);
      localStorage.setItem('taxichiDispatcherLastAdmin',id);
      if(data.remember)localStorage.setItem('taxichiDispatcherRemember',id);
      else localStorage.removeItem('taxichiDispatcherRemember');
      location.href=`${location.pathname}?admin=${encodeURIComponent(id)}`;
    }catch(err){
      console.warn('admin login failed',err);
      if(err.status===401){
        setError('Логин или пароль неверно, обратитесь в поддержку');
      }else{
        setError(`Сервер не отвечает (${errorCode(err)}). Откройте https://admin.taxichi.pro/?reset=1 и попробуйте ещё раз.`);
      }
    }finally{
      if(button){button.disabled=false;button.textContent=oldText||'Войти'}
    }
  },true);
})();
