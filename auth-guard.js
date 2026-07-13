(function(){
  const key='taxichiDispatcherSession',rememberKey='taxichiDispatcherRemember';
  const initial=window.__taxichiInitialAdminSession||'';
  let submitted=false,rememberRequested=false;
  function login(){return document.querySelector('#loginScreen')}
  function form(){return document.querySelector('#loginForm')}
  function trusted(){return !!initial||!!localStorage.getItem(rememberKey)||submitted}
  function lock(){
    if(trusted())return;
    sessionStorage.removeItem(key);
    login()?.classList.remove('hidden');
    if(location.search.includes('admin='))history.replaceState(null,'',location.pathname);
  }
  function rememberIfNeeded(){
    const id=sessionStorage.getItem(key)||'';
    if(rememberRequested&&id)localStorage.setItem(rememberKey,id);
  }
  document.addEventListener('submit',event=>{
    if(event.target===form()){
      submitted=true;
      rememberRequested=!!event.target.elements.remember?.checked;
    }
  },true);
  document.addEventListener('click',event=>{
    if(event.target?.classList?.contains('logout-access'))localStorage.removeItem(rememberKey);
  },true);
  [0,200,800,1800,3200].forEach(ms=>setTimeout(()=>{lock();rememberIfNeeded()},ms));
})();
