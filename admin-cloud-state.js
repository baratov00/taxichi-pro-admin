(function(){
  const CLOUD_VERSION='20260719-2';
  const CLOUD_KEYS=['taxichiProDrivers','taxichiProOrganizations','taxichiProStaff','taxichiProVehicles','taxichiProScheduleSettings'];
  let restoreBusy=false,uploadTimer=0,lastUploaded='',restoreDone=false,lastCloudCounts=null;

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
  function writeLocal(name,value){localStorage.setItem(key(name),JSON.stringify(value))}
  function safeArray(value){return Array.isArray(value)?value:[]}
  function dataCounts(value){
    return {
      drivers:safeArray(value?.drivers).length,
      organizations:safeArray(value?.organizations).length,
      staff:safeArray(value?.staff).length,
      vehicles:safeArray(value?.vehicles).length
    };
  }
  function totalCounts(counts){return Number(counts?.drivers||0)+Number(counts?.organizations||0)+Number(counts?.staff||0)+Number(counts?.vehicles||0)}
  function stateObject(){
    return {
      version:CLOUD_VERSION,
      updatedAt:new Date().toISOString(),
      drivers:safeArray(drivers),
      organizations:safeArray(organizations),
      staff:safeArray(staff),
      vehicles:safeArray(vehicles),
      scheduleSettings:scheduleSettings||{drivers:{}}
    };
  }
  function stable(value){try{return JSON.stringify(value)}catch{return ''}}
  function localHasData(){return totalCounts(dataCounts(stateObject()))>0}
  function parseSettings(value){
    if(!value)return {};
    if(typeof value==='string'){try{return JSON.parse(value)}catch{return {}}}
    return value||{};
  }
  function countTriples(value){
    const s=stable(value);
    let n=0;
    for(let i=0;i<s.length-2;i++)if(s.slice(i,i+3)==='???')n++;
    return n;
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
  function shouldPreferCloud(cloud){
    if(!cloud)return false;
    const cloudTime=Date.parse(cloud.updatedAt||'')||0;
    const localTime=Number(localStorage.getItem(key('taxichiCloudStateAt'))||0);
    const cloudCounts=dataCounts(cloud);
    const localCounts=dataCounts(stateObject());
    if(totalCounts(localCounts)===0&&totalCounts(cloudCounts)>0)return true;
    if(cloudTime>localTime)return true;
    if(totalCounts(cloudCounts)>totalCounts(localCounts))return true;
    if(countTriples(stateObject())>countTriples(cloud))return true;
    return false;
  }
  async function restoreFromCloud(){
    if(restoreBusy||!available()||ACTIVE_ADMIN_ID==='demo')return;
    restoreBusy=true;
    try{
      const row=await dispatcherRow();
      const settings=parseSettings(row?.payment_settings);
      const cloud=settings.adminData;
      if(cloud){
        lastCloudCounts=dataCounts(cloud);
        lastUploaded=stable(cloud);
        if(shouldPreferCloud(cloud)&&applyState(cloud)){
          localStorage.setItem(key('taxichiCloudStateAt'),String(Date.parse(cloud.updatedAt||'')||Date.now()));
          if(typeof render==='function')render();
        }
      }else if(localHasData()){
        scheduleCloudUpload();
      }
    }catch(error){
      console.warn('Не удалось восстановить данные админки из облака',error);
    }finally{
      restoreDone=true;
      restoreBusy=false;
    }
  }
  function uploadWouldLoseCloudData(state){
    if(!lastCloudCounts)return false;
    const counts=dataCounts(state);
    return totalCounts(counts)<totalCounts(lastCloudCounts);
  }
  async function uploadCloudState(){
    if(!available()||ACTIVE_ADMIN_ID==='demo'||!localHasData())return;
    if(!restoreDone){
      scheduleCloudUpload();
      return;
    }
    const state=stateObject();
    if(uploadWouldLoseCloudData(state)){
      await restoreFromCloud();
      return;
    }
    const snapshot=stable(state);
    if(snapshot===lastUploaded)return;
    try{
      const row=await dispatcherRow();
      const settings=parseSettings(row?.payment_settings);
      const existing=settings.adminData;
      if(existing){
        lastCloudCounts=dataCounts(existing);
        if(totalCounts(dataCounts(state))<totalCounts(lastCloudCounts)){
          applyState(existing);
          if(typeof render==='function')render();
          return;
        }
      }
      settings.adminData=state;
      const response=await fetch(`${API_BASE}/taxichi_pro_dispatchers?id=eq.${encodeURIComponent(ACTIVE_ADMIN_ID)}`,{
        method:'PATCH',
        headers:{...API_HEADERS,'Content-Type':'application/json','Prefer':'return=minimal'},
        body:JSON.stringify({payment_settings:settings,updated_at:new Date().toISOString()})
      });
      if(!response.ok)throw new Error(await response.text());
      lastUploaded=snapshot;
      lastCloudCounts=dataCounts(state);
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
    restoreFromCloud();
    setInterval(restoreFromCloud,30000);
  }

  install();
})();
