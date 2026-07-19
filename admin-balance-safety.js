(function(){
  const VERSION='20260714-1';
  const DAY=24*60*60*1000;

  function ready(){
    if(window.taxichiBalanceUiVersion)return false;
    return typeof activeDispatcherSettings==='function'
      && typeof remoteProfilesByPhone==='function'
      && typeof driverProfileRow==='function'
      && typeof profilePayload==='function'
      && typeof mergeSubscriptionState==='function'
      && typeof requestBalanceAmount==='function'
      && typeof render==='function'
      && typeof drivers!=='undefined';
  }

  function cleanHistory(items){
    const cutoff=Date.now()-7*DAY;
    const seen=new Set();
    return (Array.isArray(items)?items:[])
      .filter(item=>{
        const time=Date.parse(item?.date||'');
        return !Number.isFinite(time)||time>=cutoff;
      })
      .filter(item=>{
        const key=[item?.operationId||'',item?.waybillId||'',item?.date||'',item?.amount||0,item?.reason||''].join('|');
        if(seen.has(key))return false;
        seen.add(key);
        return true;
      })
      .slice(0,50);
  }

  async function remoteProfileForDriver(d,row){
    const digits=phoneDigits(d.phone||row.phone||'');
    const remote=digits?await remoteProfilesByPhone(digits).catch(()=>[]):[];
    return remote.find(profile=>sameProfile(profile,d.id))||remote[0]||null;
  }

  async function saveBalance(d,direction,amount){
    const row=driverProfileRow(d);
    const current=await remoteProfileForDriver(d,row);
    const payload=mergeSubscriptionState(row.payload,profilePayload(current));
    const subscription={...(payload.subscription||{})};
    const currentBalance=Number(subscription.balance||0);
    const delta=direction==='plus'?amount:-amount;
    const next=currentBalance+delta;

    if(next<0){
      alert('Недостаточно баланса. Нельзя списать больше, чем доступно у водителя.');
      return null;
    }

    subscription.balance=next;
    subscription.history=cleanHistory([
      {
        date:new Date().toISOString(),
        amount:delta,
        reason:direction==='plus'?'Пополнение через админку':'Списание через админку',
        balance:next,
        source:'admin',
        operationId:`admin-${direction}-${d.id||row.phone_digits}-${Date.now()}`
      },
      ...(((payload.subscription||{}).history)||[])
    ]);
    payload.subscription=subscription;
    row.payload=payload;

    const response=await fetch(API_BASE+'/driver_profiles?on_conflict=id',{
      method:'POST',
      headers:{...API_HEADERS,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'},
      body:JSON.stringify(row)
    });
    if(!response.ok){
      throw new Error(await response.text());
    }
    return {balance:next,history:subscription.history};
  }

  function install(){
    if(!ready()){
      setTimeout(install,150);
      return;
    }

    window.taxichiAdminBalanceSafety=VERSION;
    adminAdjustDriverBalance=async function(driverIndex,direction){
      const d=drivers[driverIndex];
      if(!d)return;
      const pay=activeDispatcherSettings();
      if(pay.mode!=='admin_balance'){
        alert('Сначала директор должен выбрать тип оплаты «Пополнить через админку».');
        return;
      }
      const amount=await requestBalanceAmount(d,direction,pay.epPrice||500);
      if(amount===null)return;
      try{
        const saved=await saveBalance(d,direction,amount);
        if(!saved)return;
        d.balance=saved.balance;
        d.balanceHistory=saved.history;
        store('taxichiProDrivers',drivers);
        render();
      }catch(error){
        console.error('balance safety update failed',error);
        alert('Не удалось обновить баланс. Проверьте интернет и повторите попытку.');
      }
    };
  }

  install();
})();
