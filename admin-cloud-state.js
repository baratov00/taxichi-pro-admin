(function(){
  const CLOUD_VERSION='20260719-1';
  const STATE_KEYS=['taxichiProDrivers','taxichiProOrganizations','taxichiProStaff','taxichiProVehicles','taxichiProScheduleSettings'];
  let restoreBusy=false,uploadTimer=0,lastUploaded='';

  function available(){
    return typeof ACTIVE_ADMIN_ID!=='undefined'
      && typeof API_BASE!=='undefined'
      && typeof API_HEADERS!=='undefined'
      && typeof drivers!=='undefined'
      && typeof organizations!=='undefined'
      && typeof staff!=='undefined'
      && typeof vehicles!=='undefined'
      && typeof scheduleSettings!=='undefined';
  }

  function key(name){return `taxichiProAdmin:${ACTIVE_ADMIN_ID}:${name}`}
  function readLocal(name,fallback){try{return JSON.parse(localStorage.getItem(key(name))||'null')??fallback}catch{return fallback}}
  function writeLocal(name,value){localStorage.setItem(key(name),JSON.stringify(value))}
  function stateObject(){
    return {
      version:CLOUD_VERSION,
      updatedAt:new Date().toISOString(),
      drivers,
      organizations,
      staff,
      vehicles,
      scheduleSettings
    };
  }
  function stable(value){try{return JSON.stringify(value)}catch{return ''}}
  function localHasData(){
    return (Array.isArray(drivers)&&drivers.length>0)
      ||(Array.isArray(organizations)&&organizations.length>0)
      ||(Array.isArray(vehicles)&&vehicles.length>0)
      ||(Array.isArray(staff)&&staff.length>0);
  }
  function parseSettings(value){
    if(!value)return {};
    if(typeof value==='string'){try{return JSON.parse(value)}catch{return {}}}
    return value||{};
  }
  async function dispatcherRow(){
    const response=await fetch(`${API_BASE}/taxichi_pro_dispatchers?select=id,payment_settings&id=eq.${encodeURIComponent(ACTIVE_ADMIN_ID)}&limit=1`,{headers:API_HEADERS,cache:'no-store'});
    if(!response.ok)throw new Error(await response.text());
    return (await response.json())[0]||null;
  }
  function applyState(cloud){
    if(!cloud||typeof cloud!=='object')return false;
    let changed=false;
    if(Array.isArray(cloud.drivers)){drivers=cloud.drivers;writeLocal('taxichiProDrivers',drivers);changed=true}
    if(Array.isArray(cloud.organizations)){organizations=cloud.organizations;writeLocal('taxichiProOrganizations',organizations);changed=true}
    if(Array.isArray(cloud.staff)){staff=cloud.staff;writeLocal('taxichiProStaff',staff);changed=true}
    if(Array.isArray(cloud.vehicles)){vehicles=cloud.vehicles;writeLocal('taxichiProVehicles',vehicles);changed=true}
    if(cloud.scheduleSettings&&typeof cloud.scheduleSettings==='object'){
      scheduleSettings=cloud.scheduleSettings;
      scheduleSettings.drivers=scheduleSettings.drivers||{};
      writeLocal('taxichiProScheduleSettings',scheduleSettings);
      changed=true;
    }
    return changed;
  }
  async function restoreFromCloud(){
    if(restoreBusy||!available()||ACTIVE_ADMIN_ID==='demo')return;
    restoreBusy=true;
    try{
      const row=await dispatcherRow();
      const settings=parseSettings(row?.payment_settings);
      const cloud=settings.adminData;
      if(cloud&&(!localHasData()||Date.parse(cloud.updatedAt||'')>Number(localStorage.getItem(key('taxichiCloudStateAt'))||0))){
        if(applyState(cloud)){
          localStorage.setItem(key('taxichiCloudStateAt'),String(Date.parse(cloud.updatedAt||'')||Date.now()));
          if(typeof render==='function')render();
        }
      }else if(!cloud&&localHasData()){
        scheduleCloudUpload();
      }
    }catch(error){
      console.warn('Не удалось восстановить данные админки из облака',error);
    }finally{
      restoreBusy=false;
    }
  }
  async function uploadCloudState(){
    if(!available()||ACTIVE_ADMIN_ID==='demo'||!localHasData())return;
    const state=stateObject(),snapshot=stable(state);
    if(snapshot===lastUploaded)return;
    try{
      const row=await dispatcherRow();
      const settings=parseSettings(row?.payment_settings);
      settings.adminData=state;
      const response=await fetch(`${API_BASE}/taxichi_pro_dispatchers?id=eq.${encodeURIComponent(ACTIVE_ADMIN_ID)}`,{
        method:'PATCH',
        headers:{...API_HEADERS,'Content-Type':'application/json','Prefer':'return=minimal'},
        body:JSON.stringify({payment_settings:settings,updated_at:new Date().toISOString()})
      });
      if(!response.ok)throw new Error(await response.text());
      lastUploaded=snapshot;
      localStorage.setItem(key('taxichiCloudStateAt'),String(Date.now()));
    }catch(error){
      console.warn('Не удалось сохранить данные админки в облако',error);
    }
  }
  function scheduleCloudUpload(){
    clearTimeout(uploadTimer);
    uploadTimer=setTimeout(uploadCloudState,700);
  }

  function install(){
    if(!available()){setTimeout(install,150);return}
    const originalSave=save;
    save=function(){originalSave();scheduleCloudUpload()};
    window.taxichiCloudSaveNow=uploadCloudState;
    window.taxichiCloudRestoreNow=restoreFromCloud;
    restoreFromCloud().then(()=>scheduleCloudUpload());
    setInterval(restoreFromCloud,30000);
  }

  install();
})();
