/* AVTODROM waiting queue fix
   The queue is local to the operator panel and never calls START.
   Therefore an already active vehicle can be queued without a 409 error.
*/
(function(){
  'use strict';

  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m]));

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

  /* ===== STUDENT EXCEL EXPORT: PLATE IS OPTIONAL ===== */
  function xesc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');}
  function xdt(v){if(!v)return '—';try{return new Date(v).toLocaleString('uz-UZ')}catch{return String(v)}}
  function xdur(sec){sec=Math.max(0,Number(sec||0));const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;return `${h} soat ${m} daqiqa ${s} soniya`}
  function findUuid(text){const m=String(text||'').match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);return m?m[0]:''}
  function findStudent(btn){
    const uuid=findUuid(btn.getAttribute('onclick')||'')||findUuid(btn.dataset?.studentId||'');
    if(uuid)return {id:uuid};
    const card=btn.closest('.card,.adminSchoolGroupCard,.studentCard,.student-row,li,div');
    const text=card?.textContent||'';
    try{
      const list=(typeof students!=='undefined'&&Array.isArray(students))?students:[];
      const exact=list.find(s=>s&&s.full_name&&text.includes(s.full_name));
      if(exact)return exact;
    }catch{}
    return null;
  }
  function downloadXls(student,rows){
    const safeStudent=student||{};
    const history=Array.isArray(rows)?rows:[];
    const headers=['F.I.Sh.','Tug‘ilgan sana','Avtoshkola','Guruh','Darslar soni','Sana va vaqt','Tugash vaqti','Davomiylik','Avtomobil','Summa','To‘lov turi'];
    const baseRows=history.length?history.map(r=>[
      safeStudent.full_name||r.student_name||'',safeStudent.birth_date||'',r.school_name||safeStudent.school_name||'',r.group_name||safeStudent.group_name||'',Number(safeStudent.attendance_count||0),xdt(r.started_at),xdt(r.finished_at),xdur(r.duration_seconds),r.plate||safeStudent.plate||'',Number(r.amount||0),r.payment_method||''
    ]):[[safeStudent.full_name||'',safeStudent.birth_date||'',safeStudent.school_name||'',safeStudent.group_name||'',Number(safeStudent.attendance_count||0),'','','',safeStudent.plate||'','', '']];
    const body=baseRows.map(row=>'<tr>'+row.map(x=>`<td>${xesc(x)}</td>`).join('')+'</tr>').join('');
    const html='<!doctype html><html><head><meta charset="utf-8"><style>table{border-collapse:collapse;font-family:Arial;font-size:11pt}th,td{border:1px solid #b7c9c0;padding:7px 9px;white-space:nowrap}th{background:#087443;color:#fff}</style></head><body><h2>AVTODROM — O‘quvchi dars tarixi</h2><p>Avtomobil raqami majburiy emas.</p><table><thead><tr>'+headers.map(x=>'<th>'+xesc(x)+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table></body></html>';
    const blob=new Blob(['\ufeff',html],{type:'application/vnd.ms-excel;charset=utf-8'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='oquvchi-dars-tarixi-'+String(safeStudent.full_name||'student').replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'')+'.xls';
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function exportStudentExcel(btn){
    const found=findStudent(btn);
    if(!found){if(typeof window.toast==='function')window.toast('O‘quvchini aniqlab bo‘lmadi',true);return false;}
    const id=found.id;
    try{
      let rows=[];
      if(id){
        const token=localStorage.getItem('avtodrom_token')||'';
        const response=await fetch('/api/student-history?studentId='+encodeURIComponent(id),{headers:token?{Authorization:'Bearer '+token}:{}});
        const result=await response.json().catch(()=>({}));
        if(!response.ok) throw new Error(result.error||'Tarixni olishda xatolik');
        rows=Array.isArray(result?.rows)?result.rows:[];
        if(result?.student) Object.assign(found,result.student);
      }
      downloadXls(found,rows);
      if(typeof window.toast==='function')window.toast(rows.length?'Excel tayyor — avtomobil raqami talab qilinmaydi':'Excel tayyor — o‘quvchi ma’lumotlari eksport qilindi');
    }catch(e){
      downloadXls(found,[]);
      if(typeof window.toast==='function')window.toast('Excel tayyor. Avtomobil raqami shart emas.');
    }
    return false;
  }
  document.addEventListener('click',function(e){
    const btn=e.target?.closest?.('button');
    if(!btn)return;
    const label=(btn.textContent||'').replace(/\s+/g,' ').trim().toLowerCase();
    if(!label.includes('excel')||!label.includes('tarix'))return;
    e.preventDefault();
    e.stopImmediatePropagation();
    exportStudentExcel(btn);
  },true);
})();
