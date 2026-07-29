(function(){
  const form=document.getElementById('loginForm');
  const error=document.getElementById('loginError');
  if(!form||form.dataset.cloudLoginFix==='1')return;
  form.dataset.cloudLoginFix='1';

  const SUPABASE_URL='https://qquvbedufztponyxneqa.supabase.co';
  const SUPABASE_KEY='sb_publishable_8lZ9AfMvjZOx1Xz6JTlNFg_uKK0qjr8';
  const AUTH_URL=SUPABASE_URL+'/functions/v1/taxichi-auth';

  const params=new URLSearchParams(location.search);
  if(params.get('reset')==='1'){
    sessionStorage.clear();
    localStorage.removeItem('taxichiDispatcherRemember');
    localStorage.removeItem('taxichiDispatcherLastAdmin');
    location.replace(location.pathname);
    return;
  }

  function setError(text){if(error)error.textContent=text}
  function errorCode(err){
    if(err?.status)return `HTTP ${err.status}`;
    if(err?.name==='AbortError')return 'TIMEOUT';
    if(String(err?.message||'').includes('Failed to fetch'))return 'NETWORK';
    return err?.message||'UNKNOWN';
  }
  async function fetchWithTimeout(url,options={},timeoutMs=30000){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{return await fetch(url,{...options,signal:controller.signal,cache:'no-store'})}
    finally{clearTimeout(timer)}
  }
  async function adminLogin(data){
    const response=await fetchWithTimeout(AUTH_URL,{
      method:'POST',
      headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({action:'adminLogin',login:data.login,password:data.password})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(result.error||'auth_failed'),{status:response.status,result});
    if(!result?.account?.id)throw new Error('bad_auth_response');
    return result;
  }
  async function fallbackLogin(data){
    const response=await fetchWithTimeout(`${SUPABASE_URL}/rest/v1/taxichi_pro_dispatchers?select=*&active=eq.true&order=created_at.asc`,{
      headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY,'Accept-Profile':'public','Content-Profile':'public'}
    },30000);
    if(!response.ok)throw Object.assign(new Error('fallback_failed'),{status:response.status});
    const clean=value=>String(value||'').trim();
    const digits=value=>String(value||'').replace(/\D/g,'');
    const rows=await response.json();
    const login=clean(data.login);
    const loginDigits=digits(login);
    const account=(rows||[]).find(row=>
      String(row.id||'')!=='demo' &&
      String(row.name||'')!=='Иванова Мария' &&
      String(row.login||'')!=='admin' &&
      (clean(row.login)===login || (loginDigits && digits(row.phone)===loginDigits)) &&
      String(row.password||'')===String(data.password||'')
    );
    if(!account)throw Object.assign(new Error('bad_credentials'),{status:401});
    return {account,sessionToken:''};
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
      let result;
      try{
        result=await adminLogin(data);
      }catch(serverError){
        if(serverError.status===401)throw serverError;
        console.warn('server login timed out, trying fallback',serverError);
        result=await fallbackLogin(data);
      }
      const id=result.account.id||'';
      sessionStorage.setItem('taxichiDispatcherSession',id);
      sessionStorage.setItem('taxichiAdminSessionToken',result.sessionToken||'');
      localStorage.setItem('taxichiDispatcherLastAdmin',id);
      if(data.remember)localStorage.setItem('taxichiDispatcherRemember',id);
      else localStorage.removeItem('taxichiDispatcherRemember');
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
