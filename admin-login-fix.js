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
  function setError(text){if(error)error.textContent=text}
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
