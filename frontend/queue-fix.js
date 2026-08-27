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

/* =========================================================
   AVTODROM RELATION HARDENING
   Instructor -> school/group/vehicle/model
   Student name -> student/school/group auto-fill
   No user-entered database IDs
   ========================================================= */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const escRel=v=>String(v??'').replace(/[&<>\"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[x]));
  const norm=v=>String(v??'').trim().toLowerCase().replace(/\s+/g,' ');
  const parsePlate=v=>{const q=String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'');let m=q.match(/^(\d{2})([A-Z])(\d{3})([A-Z]{2})$/);if(m)return {region:m[1],body:q.slice(2),firstLetter:m[2],number:m[3],lastLetters:m[4]};m=q.match(/^([A-Z])(\d{3})([A-Z]{2})$/);if(m)return {body:q,firstLetter:m[1],number:m[2],lastLetters:m[3]};m=q.match(/^(\d{3})([A-Z]{3})$/);if(m)return {body:q,firstLetter:m[2][0],number:m[1],lastLetters:m[2].slice(1)};return null;};
  window.v3ParsePlate=window.v3ParsePlate||parsePlate;

  let allStudents=[];
  let lookupTimer=null;
  async function loadStudents(){
    try{const x=await api('/students');allStudents=Array.isArray(x)?x:(x?.rows||x?.students||[]);renderSuggestions('');}catch(e){allStudents=[];console.warn('Student lookup:',e.message)}
  }
  function renderSuggestions(q){
    const dl=$('studentSuggestions');if(!dl)return;
    const s=norm(q);const list=allStudents.filter(x=>!s||norm([x.full_name,x.phone,x.plate,x.school_name,x.group_name].filter(Boolean).join(' ')).includes(s)).slice(0,100);
    dl.innerHTML=list.map(x=>'<option value="'+escRel(x.full_name||'')+'" label="'+escRel([x.school_name,x.group_name].filter(Boolean).join(' • '))+'"></option>').join('');
  }
  function findStudent(v){const q=norm(v);if(!q)return null;const exact=allStudents.filter(x=>norm(x.full_name)===q);if(exact.length===1)return exact[0];const m=allStudents.filter(x=>norm(x.full_name).includes(q));return m.length===1?m[0]:null;}
  async function loadGroups(schoolId,selected=''){
    const g=$('group');if(!g)return;
    if(!schoolId){g.innerHTML='<option value="">Avval avtoshkola</option>';g.disabled=true;return;}
    try{const list=await api('/groups?schoolId='+encodeURIComponent(schoolId))||[];g.innerHTML='<option value="">Guruhni tanlang</option>'+list.map(x=>'<option value="'+escRel(x.id)+'" '+(String(x.id)===String(selected)?'selected':'')+'>'+escRel(x.name)+'</option>').join('');g.disabled=$('type')?.value!=='school';}catch(e){g.innerHTML='<option value="">Guruh yuklanmadi</option>'}
  }
  async function applyStudent(s){
    if(!s)return;
    if($('studentId'))$('studentId').value=String(s.id||'');
    if($('school')&&s.school_id){$('school').value=String(s.school_id);await loadGroups(s.school_id,s.group_id||'');}
    if($('group')&&s.group_id)$('group').value=String(s.group_id);
    if($('studentBox'))$('studentBox').innerHTML='<div class="attendance"><b>'+escRel(s.full_name)+'</b><div class="muted">'+escRel(s.school_name||'')+(s.group_name?' • '+escRel(s.group_name):'')+'</div><div class="muted">📞 '+escRel(s.phone||'—')+' · 🚗 '+escRel(s.plate||'—')+' · Darslar: '+Number(s.attendance_count||0)+'</div></div>';
  }
  function bindStudent(){
    const el=$('student');if(!el||el.dataset.relationBound)return;el.dataset.relationBound='1';el.disabled=$('type')?.value!=='school';
    el.addEventListener('input',()=>{clearTimeout(lookupTimer);if($('studentId'))$('studentId').value='';renderSuggestions(el.value);lookupTimer=setTimeout(()=>applyStudent(findStudent(el.value)),120)});
    el.addEventListener('change',()=>applyStudent(findStudent(el.value)));
  }
  function bindSchool(){const el=$('school');if(!el||el.dataset.relationBound)return;el.dataset.relationBound='1';el.addEventListener('change',()=>loadGroups(el.value,''));}
  function applyInstructor(){
    const el=$('v3Instructor');if(!el)return;
    const id=String(el.value||'');const list=window.V3?.instructors||[];const inst=list.find(x=>String(x.id)===id);if(!inst)return;
    const p=parsePlate(inst.vehicle_plate||'');
    if(p){if(p.region&&$('region'))$('region').value=p.region;if($('plateBody'))$('plateBody').value=p.body;}
    if($('model')&&inst.vehicle_model)$('model').value=inst.vehicle_model;
    if($('driver')&&inst.driver_name)$('driver').value=inst.driver_name;
    if($('school')&&inst.school_id){$('school').value=String(inst.school_id);loadGroups(inst.school_id,inst.group_id||'');}
  }
  function bindInstructor(){const el=$('v3Instructor');if(!el||el.dataset.relationBound)return;el.dataset.relationBound='1';el.addEventListener('change',applyInstructor);}
  function bootRelation(){bindStudent();bindSchool();bindInstructor();if(!allStudents.length)loadStudents();}
  const oldGo=window.go;window.go=function(page){oldGo(page);setTimeout(()=>{if(page==='add')bootRelation();if(page==='instructors')bindInstructor()},0)};
  const oldLoad=window.v3LoadInstructors;
  if(oldLoad&&!oldLoad.__relation){const w=async function(){const r=await oldLoad();setTimeout(bindInstructor,0);return r};w.__relation=true;window.v3LoadInstructors=w;}
  setTimeout(bootRelation,150);
})();
