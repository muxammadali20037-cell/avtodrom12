/* AVTODROM waiting queue fix
   The queue is local to the operator panel and never calls START.
   Therefore an already active vehicle can be queued without a 409 error.
*/
(function(){
  'use strict';

  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  function install(){
    if(typeof window.enqueueLesson!=='function') return false;

    window.addSelectedToWaiting=async function(){
      const region=String($('region')?.value||'').trim();
      const body=String($('plateBody')?.value||'').replace(/\s+/g,'').toUpperCase();
      const type=$('type')?.value||'ordinary';
      const schoolId=$('school')?.value||'';
      const groupId=$('group')?.value||'';
      const studentOption=$('student')?.selectedOptions?.[0];
      const studentId=$('student')?.value||'';
      const studentName=studentOption?.textContent?.trim()||'Oddiy mijoz';
      const err=$('startErr');

      if(!/^\d{2}$/.test(region)){
        if(err)err.textContent='Viloyat kodini tanlang.';
        return;
      }
      if(!/^[A-Z0-9]{6}$/.test(body)){
        if(err)err.textContent='Raqamni 6 ta belgi qilib yozing: 111QQQ yoki A555AA.';
        return;
      }
      if(type==='school' && !studentId){
        if(err)err.textContent='O‘quvchini tanlang.';
        return;
      }

      const queueId=crypto.randomUUID?crypto.randomUUID():String(Date.now())+'-'+Math.random();
      const item={
        queueId,
        regionCode:region,
        plateBody:body,
        plate:`${region} ${body}`,
        studentId:type==='school'?studentId:null,
        studentName:type==='school'?studentName:'Oddiy mijoz',
        schoolId:type==='school'?(schoolId||null):null,
        groupId:type==='school'?(groupId||null):null,
        type,
        createdAt:new Date().toISOString()
      };

      try{
        const added=window.enqueueLesson(item);
        if(added===false){
          if(err)err.textContent='Bu avtomobil allaqachon kutish navbatida.';
          return;
        }
        if(typeof window.waitingQueueHTML==='function' && $('waitingQueueAdd')){
          $('waitingQueueAdd').innerHTML=window.waitingQueueHTML();
        }
        if(err)err.textContent='';
        if(typeof window.toast==='function') window.toast(`${region} ${body} kutish rejimiga qo‘shildi`);
        if(typeof window.resetStart==='function') window.resetStart();
      }catch(e){
        if(err)err.textContent=e.message||'Kutish rejimiga qo‘shishda xatolik';
      }
    };

    return true;
  }

  let tries=0;
  const timer=setInterval(()=>{
    tries++;
    if(install()||tries>50) clearInterval(timer);
  },100);
})();
