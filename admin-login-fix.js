(function(){
  const form=document.getElementById('loginForm');
  const error=document.getElementById('loginError');
  if(!form||form.dataset.cloudLoginFix==='1')return;
  form.dataset.cloudLoginFix='1';

  const SUPABASE_URL='https://qquvbedufztponyxneqa.supabase.co';
  const SUPABASE_KEY='sb_publishable_8lZ9AfMvjZOx1Xz6JTlNFg_uKK0qjr8';
  const API_BASE=SUPABASE_URL+'/rest/v1';
  const API_HEADERS={apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY,'Accept-Profile':'public','Content-Profile':'public'};
  const phoneDigits=value=>String(value||'').replace(/\D/g,'');
  const clean=value=>String(value||'').trim();
  const removed=d=>String(d?.id||'')==='demo'||String(d?.name||'')==='Иванова Мария'||String(d?.login||'')==='admin';
  const match=(account,login)=>clean(account.login)===clean(login)||(phoneDigits(login)&&phoneDigits(account.phone)===phoneDigits(login));

  const params=new URLSearchParams(location.search);
  const directorViewToken=params.get('directorView')||'';
  const adminId=params.get('admin')||'';

  if(directorViewToken&&adminId){
    validateDirectorView(adminId,directorViewToken);
  }

  function setError(text){if(error)error.textContent=text}
  function settings(value){
    if(!value)return {};
    if(typeof value==='string'){try{return JSON.parse(value)}catch{return {}}}
    return value||{};
  }

  async function fetchDispatchers(){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await fetch(`${API_BASE}/taxichi_pro_dispatchers?select=*&order=created_at.asc`,{headers:API_HEADERS,cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error(await response.text());
      return (await response.json()).filter(d=>!removed(d)&&d.active!==false);
    }finally{
      clearTimeout(timer);
    }
  }

  async function validateDirectorView(id,token){
    try{
      const response=await fetch(`${API_BASE}/taxichi_pro_dispatchers?select=id,payment_settings&id=eq.${encodeURIComponent(id)}&limit=1`,{headers:API_HEADERS,cache:'no-store'});
      if(!response.ok)throw new Error(await response.text());
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

  form.addEventListener('submit',async event=>{
    event.preventDefault();
    event.stopImmediatePropagation();
    const button=form.querySelector('button[type="submit"],button:not([type])');
    const oldText=button?button.textContent:'';
    if(button){button.disabled=true;button.textContent='Проверяем...'}
    setError('');
    try{
      const data=Object.fromEntries(new FormData(form));
      const account=(await fetchDispatchers()).find(x=>match(x,data.login)&&String(x.password||'')===String(data.password||''));
      if(!account){
        setError('Логин или пароль неверно, обратитесь в поддержку');
        return;
      }
      const id=account.id||'';
      sessionStorage.setItem('taxichiDispatcherSession',id);
      localStorage.setItem('taxichiDispatcherLastAdmin',id);
      if(data.remember)localStorage.setItem('taxichiDispatcherRemember',id);
      else localStorage.removeItem('taxichiDispatcherRemember');
      location.href=`${location.pathname}?admin=${encodeURIComponent(id)}`;
    }catch(err){
      console.warn('admin login failed',err);
      setError('Сервер не отвечает. Проверьте интернет или обратитесь в поддержку');
    }finally{
      if(button){button.disabled=false;button.textContent=oldText||'Войти'}
    }
  },true);
})();
