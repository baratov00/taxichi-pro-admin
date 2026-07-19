// Cloud balance UI + automatic EP waybill debit.
(function(){
  const VERSION='20260719-2';
  const DAY=24*60*60*1000;
  const STARTED_AT=Date.now();

  window.taxichiBalanceUiVersion=VERSION;

  function balanceHistoryLast7Days(items){
    const cutoff=Date.now()-7*DAY;
    const seen=new Set();
    return (Array.isArray(items)?items:[])
      .filter(item=>{
        const time=Date.parse(item?.date||'');
        return !Number.isFinite(time)||time>=cutoff;
      })
      .filter(item=>{
        const key=String(item?.operationId||item?.waybillId||`${item?.date}|${item?.amount}|${item?.reason}`);
        if(seen.has(key))return false;
        seen.add(key);
        return true;
      })
      .slice(0,80);
  }

  window.balanceHistoryLast7Days=balanceHistoryLast7Days;

  function profileRowForDriverSafe(d){
    const row=driverProfileRow(d);
    row.phone_digits=row.phone_digits||phoneDigits(d.phone);
    row.updated_at=new Date().toISOString();
    return row;
  }

  async function writeDriverProfileRow(row){
    const headers={...API_HEADERS,'Content-Type':'application/json'};
    let response=await fetch(API_BASE+'/driver_profiles?on_conflict=id',{
      method:'POST',
      headers:{...headers,Prefer:'resolution=merge-duplicates,return=minimal'},
      body:JSON.stringify(row)
    });
    if(response.ok)return true;

    response=await fetch(`${API_BASE}/driver_profiles?phone_digits=eq.${encodeURIComponent(row.phone_digits)}`,{
      method:'PATCH',
      headers:{...headers,Prefer:'return=minimal'},
      body:JSON.stringify({
        phone:row.phone,
        phone_digits:row.phone_digits,
        password:row.password,
        payload:row.payload,
        updated_at:row.updated_at
      })
    });
    if(response.ok)return true;

    response=await fetch(API_BASE+'/driver_profiles',{
      method:'POST',
      headers:{...headers,Prefer:'return=minimal'},
      body:JSON.stringify(row)
    });
    if(response.ok)return true;
    throw new Error(await response.text());
  }

  async function writeDriverProfileFallback(row){
    if(typeof syncProfileViaWaybills==='function')return syncProfileViaWaybills(row);
    return false;
  }

  async function remoteProfileForDriver(d,row){
    const digits=phoneDigits(d.phone||row.phone||'');
    const remote=digits?await remoteProfilesByPhone(digits).catch(()=>[]):[];
    return remote.find(profile=>sameProfile(profile,d.id))||remote[0]||null;
  }

  function mergeCloudBalanceIntoDriver(d,subscription){
    if(!subscription)return false;
    const nextBalance=Number(subscription.balance??d.balance??0);
    const nextHistory=balanceHistoryLast7Days(Array.isArray(subscription.history)?subscription.history:[]);
    if(Number(d.balance||0)!==nextBalance||JSON.stringify(d.balanceHistory||[])!==JSON.stringify(nextHistory)){
      d.balance=nextBalance;
      d.balanceHistory=nextHistory;
      return true;
    }
    return false;
  }

  function requestBalanceAmount(d,direction,suggested){
    return new Promise(resolve=>{
      let dialog=document.querySelector('#balanceAdjustDialog');
      if(!dialog){
        dialog=document.createElement('dialog');
        dialog.id='balanceAdjustDialog';
        dialog.className='balance-adjust-dialog';
        document.body.append(dialog);
      }
      const plus=direction==='plus';
      const current=Number(d.balance||0);
      const value=Number(suggested||0)>0?Number(suggested):1;
      dialog.innerHTML=`<form method="dialog" class="balance-adjust-form">
        <button class="balance-dialog-close" value="cancel" aria-label="Закрыть">×</button>
        <div class="balance-dialog-icon ${plus?'is-plus':'is-minus'}">${plus?'+':'−'}</div>
        <div><small>${plus?'ПОПОЛНЕНИЕ':'СПИСАНИЕ'} БАЛАНСА</small><h2>${full(d)}</h2><p>${d.phone||'Телефон не указан'}</p></div>
        <div class="balance-dialog-current"><span>Текущий баланс</span><strong>${money(current)}</strong></div>
        <label>Введите сумму, ₽<input inputmode="decimal" type="number" min="1" step="1" value="${value}" required autofocus></label>
        <div class="balance-dialog-preview">Новый баланс: <b>${money(plus?current+value:current-value)}</b></div>
        <div class="balance-dialog-actions"><button value="cancel" class="balance-cancel">Отмена</button><button value="confirm" class="balance-confirm ${plus?'is-plus':'is-minus'}">${plus?'Пополнить баланс':'Списать с баланса'}</button></div>
      </form>`;
      const input=dialog.querySelector('input');
      const preview=dialog.querySelector('.balance-dialog-preview b');
      input.oninput=()=>{
        const amount=Number(input.value||0);
        preview.textContent=money(plus?current+amount:current-amount);
      };
      dialog.onclose=()=>{
        const amount=Number(input.value);
        resolve(dialog.returnValue==='confirm'&&Number.isFinite(amount)&&amount>0?amount:null);
      };
      dialog.showModal();
      setTimeout(()=>input.select(),50);
    });
  }

  window.requestBalanceAmount=requestBalanceAmount;

  syncDriverProfile=async function(d){
    const row=profileRowForDriverSafe(d);
    if(!row.phone_digits||!row.password)return false;

    let remote=[];
    try{remote=await remoteProfilesByPhone(row.phone_digits)}catch(error){console.warn('profile precheck failed',error)}
    if(remote.some(profile=>!sameProfile(profile,d.id))){
      console.warn('driver profile exists for phone',row.phone_digits);
      return false;
    }

    const current=remote.find(profile=>sameProfile(profile,d.id));
    if(current)row.payload=mergeSubscriptionState(row.payload,profilePayload(current));

    try{return await writeDriverProfileRow(row)}
    catch(error){
      console.warn('driver_profiles write failed, trying fallback',error);
      try{return await writeDriverProfileFallback(row)}
      catch(fallbackError){console.warn('profile fallback failed',fallbackError);return false}
    }
  };

  async function saveManualBalance(d,direction,amount){
    const row=profileRowForDriverSafe(d);
    const current=await remoteProfileForDriver(d,row);
    const payload=mergeSubscriptionState(row.payload,profilePayload(current));
    const subscription={...(payload.subscription||{})};
    const delta=direction==='plus'?amount:-amount;
    const next=Number(subscription.balance||0)+delta;

    if(next<0){
      alert('Недостаточно баланса. Нельзя списать больше, чем доступно у водителя.');
      return null;
    }

    subscription.balance=next;
    subscription.history=balanceHistoryLast7Days([
      {
        date:new Date().toISOString(),
        amount:delta,
        reason:direction==='plus'?'Пополнение через админку':'Списание через админку',
        balance:next,
        source:'admin',
        operationId:`admin-${direction}-${d.id||row.phone_digits}-${Date.now()}`
      },
      ...profileHistoryFromPayload(payload)
    ]);
    payload.subscription=subscription;
    row.payload=payload;
    await writeDriverProfileRow(row);
    return subscription;
  }

  adminAdjustDriverBalance=async function(driverIndex,direction){
    const d=drivers[driverIndex];
    if(!d)return;
    const pay=activeDispatcherSettings();
    if(pay.mode!=='admin_balance')return alert('Сначала директор должен выбрать тип оплаты «Пополнить через админку».');
    const amount=await requestBalanceAmount(d,direction,pay.epPrice||1);
    if(amount===null)return;

    try{
      const subscription=await saveManualBalance(d,direction,amount);
      if(!subscription)return;
      d.balance=Number(subscription.balance||0);
      d.balanceHistory=subscription.history||[];
      store('taxichiProDrivers',drivers);
      render();
      if(typeof window.taxichiCloudSaveNow==='function')window.taxichiCloudSaveNow();
    }catch(error){
      console.error('balance update failed',error);
      alert('Не удалось обновить баланс. Проверьте интернет и повторите попытку.');
    }
  };

  function decodeWaybillPayload(w){
    const opened=String(w?.openedBy||'');
    const encoded=(opened.match(/(?:^|;)data=([^;]+)/)||[])[1];
    if(!encoded)return {};
    try{return JSON.parse(decodeURIComponent(encoded))}catch{return {}}
  }

  function findDriverForWaybill(w){
    const meta=decodeWaybillPayload(w);
    if(meta.driverId){
      const byId=drivers.find(d=>String(d.id||'')===String(meta.driverId));
      if(byId)return {driver:byId,meta};
    }
    const digits=phoneDigits(w.phone||meta.driver?.phone||'');
    const plate=String(w.plate||meta.vehicle?.plate||'').replace(/\s+/g,'').toUpperCase();
    const name=String(w.driver||meta.driver?.fullName||'').trim().toLowerCase();
    const driver=drivers.find(d=>{
      const vehicle=typeof vehicleForDriver==='function'?vehicleForDriver(d):{};
      return (digits&&phoneDigits(d.phone)===digits)
        ||(plate&&String(vehicle.plate||d.plate||'').replace(/\s+/g,'').toUpperCase()===plate)
        ||(name&&full(d).trim().toLowerCase()===name);
    });
    return {driver,meta};
  }

  function shouldDebitWaybill(w,meta){
    if(!w||String(w.openedBy||'').startsWith('profile;'))return false;
    if(typeof waybillAdminId==='function'&&waybillAdminId(w)!==ACTIVE_ADMIN_ID)return false;
    const time=Date.parse(w.date||'');
    if(Number.isFinite(time)&&time<STARTED_AT-2*60*1000)return false;
    const mode=meta?.subscription?.paymentMode||activeDispatcherSettings().mode;
    return mode==='admin_balance';
  }

  async function debitWaybillBalance(w){
    const {driver:d,meta}=findDriverForWaybill(w);
    if(!d||!shouldDebitWaybill(w,meta))return false;

    const pay=activeDispatcherSettings();
    const amount=Number(meta?.subscription?.epPrice||pay.epPrice||0);
    if(!Number.isFinite(amount)||amount<=0)return false;

    const operationId=`waybill-${w.id}`;
    const row=profileRowForDriverSafe(d);
    const current=await remoteProfileForDriver(d,row);
    const payload=mergeSubscriptionState(row.payload,profilePayload(current));
    const subscription={...(payload.subscription||{})};
    const history=balanceHistoryLast7Days(profileHistoryFromPayload(payload));
    if(history.some(item=>String(item.operationId||'')===operationId||String(item.waybillId||'')===String(w.id)))return false;

    const currentBalance=Number(subscription.balance||0);
    const next=currentBalance-amount;
    subscription.balance=next;
    subscription.history=balanceHistoryLast7Days([
      {
        date:new Date().toISOString(),
        amount:-amount,
        reason:`Списание за выпуск ЭПЛ №${w.id}`,
        balance:next,
        source:'waybill',
        waybillId:String(w.id),
        operationId
      },
      ...history
    ]);
    payload.subscription=subscription;
    row.payload=payload;
    await writeDriverProfileRow(row);

    d.balance=next;
    d.balanceHistory=subscription.history;
    store('taxichiProDrivers',drivers);
    if(typeof window.taxichiCloudSaveNow==='function')window.taxichiCloudSaveNow();
    return true;
  }

  const processingWaybillDebits=new Set();
  async function debitVisibleWaybills(){
    if(page!=='waybills'&&page!=='drivers'&&page!=='archive')return;
    if(activeDispatcherSettings().mode!=='admin_balance')return;
    const list=Array.isArray(waybills)?waybills.slice(0,40):[];
    let changed=false;
    for(const w of list){
      const id=String(w.id||'');
      if(!id||processingWaybillDebits.has(id))continue;
      processingWaybillDebits.add(id);
      try{changed=(await debitWaybillBalance(w))||changed}
      catch(error){console.warn('waybill balance debit failed',w?.id,error)}
      finally{setTimeout(()=>processingWaybillDebits.delete(id),60000)}
    }
    if(changed)render();
  }

  async function refreshDriverBalancesFromCloud(){
    if(refreshDriverBalancesFromCloud.busy||page!=='drivers'||activeDispatcherSettings().mode!=='admin_balance')return;
    refreshDriverBalancesFromCloud.busy=true;
    let changed=false;
    try{
      await Promise.all(drivers.map(async d=>{
        const digits=phoneDigits(d.phone);
        if(!digits)return;
        const remote=await remoteProfilesByPhone(digits).catch(()=>[]);
        const current=remote.find(profile=>sameProfile(profile,d.id))||remote[0];
        const subscription=profilePayload(current).subscription||{};
        if(subscription.paymentMode&&subscription.paymentMode!=='admin_balance')return;
        changed=mergeCloudBalanceIntoDriver(d,subscription)||changed;
      }));
      if(changed){
        store('taxichiProDrivers',drivers);
        render();
      }
    }finally{refreshDriverBalancesFromCloud.busy=false}
  }

  let balanceRefreshTimer=0,waybillDebitTimer=0;
  function scheduleBalanceRefresh(){
    if(page==='drivers'&&activeDispatcherSettings().mode==='admin_balance'){
      clearTimeout(balanceRefreshTimer);
      balanceRefreshTimer=setTimeout(refreshDriverBalancesFromCloud,250);
    }
    clearTimeout(waybillDebitTimer);
    waybillDebitTimer=setTimeout(debitVisibleWaybills,400);
  }

  const renderBeforeCloudBalance=render;
  render=function(){
    renderBeforeCloudBalance();
    scheduleBalanceRefresh();
  };

  setInterval(scheduleBalanceRefresh,15000);
})();
