// Allows negative EP opening offset without Android app update.
(function(){
  const VERSION='20260719-1';
  window.taxichiScheduleNegativeVersion=VERSION;

  function patchScheduleInputs(){
    document.querySelectorAll('input[name="leadMinutes"],#settingsDefaultLead,.schedule-driver-lead').forEach(input=>{
      input.min='-360';
      input.max='360';
      input.step='5';
      if(input.dataset.negativeHint==='1')return;
      input.dataset.negativeHint='1';
      input.title='Можно поставить минус: -15 означает время выезда через 15 минут';
    });
  }

  if(typeof waybillDialog==='function'){
    const originalWaybillDialog=waybillDialog;
    waybillDialog=function(){
      const result=originalWaybillDialog.apply(this,arguments);
      setTimeout(patchScheduleInputs,0);
      setTimeout(patchScheduleInputs,80);
      return result;
    };
  }

  if(typeof render==='function'){
    const originalRender=render;
    render=function(){
      originalRender();
      setTimeout(patchScheduleInputs,0);
    };
  }

  document.addEventListener('input',event=>{
    const input=event.target;
    if(!input?.matches?.('input[name="leadMinutes"],#settingsDefaultLead,.schedule-driver-lead'))return;
    input.min='-360';
  },true);

  setInterval(patchScheduleInputs,2000);
})();
