(function(){
  if(sessionStorage.getItem('taxichiDirectorViewMode')!=='1')return;
  document.body.classList.add('director-view-mode');

  const style=document.createElement('style');
  style.textContent=`
    .director-view-banner{position:sticky;top:0;z-index:9999;background:#123524;color:#dff8e8;padding:10px 16px;text-align:center;font:700 14px Arial,sans-serif}
    .director-view-mode .primary,
    .director-view-mode .approve,
    .director-view-mode .reject,
    .director-view-mode .danger-delete,
    .director-view-mode .driver-waybill,
    .director-view-mode .admin-balance-widget button,
    .director-view-mode #addDriver{opacity:.45!important;pointer-events:none!important}
    .director-view-mode .open,
    .director-view-mode .details-open,
    .director-view-mode .archive-driver-open,
    .director-view-mode .report-link,
    .director-view-mode nav button{opacity:1!important;pointer-events:auto!important}
  `;
  document.head.append(style);

  function installBanner(){
    if(document.querySelector('.director-view-banner'))return;
    const banner=document.createElement('div');
    banner.className='director-view-banner';
    banner.textContent='Режим просмотра директора — изменения отключены';
    document.body.prepend(banner);
  }

  function disableForms(){
    document.querySelectorAll('dialog input,dialog select,dialog textarea').forEach(el=>{el.disabled=true});
    document.querySelectorAll('dialog .close,dialog .cancel,dialog .details-close').forEach(el=>{el.disabled=false;el.style.pointerEvents='auto';el.style.opacity='1'});
  }

  installBanner();
  disableForms();
  new MutationObserver(()=>{installBanner();disableForms()}).observe(document.body,{childList:true,subtree:true});
})();
