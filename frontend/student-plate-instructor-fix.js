(function(){
  'use strict';
  const $=window.$||((id)=>document.getElementById(id));
  const esc=window.esc||((s)=>String(s??'').replace(/[&<>\"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[x])));
  const norm=v=>String(v??'').trim().toLocaleLowerCase('uz-UZ');
  const sortStudents=a=>(Array.isArray(a)?a:[]).slice().sort((x,y)=>String(x.full_name||'').localeCompare(String(y.full_name||''),'uz',{sensitivity:'base'}));
  let allStudents=[];
  let studentTimer=null;

  // Plate parser used by V3 start flow. Supports 555AAA and A555AA; region is a separate select.
  window.parsePlate=function(value){
    const raw=String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(/^[A-Z]\d{3}[A-Z]{2}$/.test(raw)) return {body:raw,firstLetter:raw[0],number:raw.slice(1,4),lastLetters:raw.slice(4,6),normalizedBody:raw};
    if(/^\d{3}[A-Z]{3}$/.test(raw)){
      const body=raw[3]+raw.slice(0,3)+raw.slice(4,6);
      return {body,firstLetter:raw[3],number:raw.slice(0,3),lastLetters:raw.slice(4,6),normalizedBody:body};
    }
    return null;
  };

  async function loadStudents(){
    try{ allStudents=sortStudents(await window.api('/students')||[]); return allStudents; }
    catch(e){ console.warn('Student relation:',e.message); allStudents=[]; return []; }
  }
  function renderNames(filter){
    const dl=$('studentSuggestions'); if(!dl)return;
    const q=norm(filter);
    const schoolId=String($('school')?.value||'');
    const list=sortStudents(allStudents.filter(s=>!schoolId||String(s.school_id||'')===schoolId).filter(s=>!q||norm(s.full_name).includes(q)));
    dl.innerHTML=list.slice(0,100).map(s=>'<option value="'+esc(s.full_name)+'" label="'+esc((s.school_name||'')+' • '+(s.group_name||'')+' • '+Number(s.attendance_count||0)+' marta')+'"></option>').join('');
  }
  async function fillStudent(student){
    if(!student)return;
    $('student').value=student.full_name||'';
    $('studentId').value=student.id||'';
    if(student.school_id){
      $('school').disabled=false;
      if(typeof window.loadSchoolSelect==='function') await window.loadSchoolSelect();
      $('school').value=String(student.school_id);
    }
    // Keep group only as an internal relation. It is not shown to the operator.
    $('group').value=student.group_id?String(student.group_id):'';
    $('group').disabled=false;
    const n=Number(student.attendance_count||0);
    $('studentBox').innerHTML='<div class="attendance"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap"><div><b style="font-size:19px">'+esc(student.full_name)+'</b><div class="muted">📞 '+esc(student.phone||'Telefon yo‘q')+'</div></div><span class="badge '+(n>=12?'blue':n>=6?'red':'')+'">'+n+' marta qatnashgan</span></div><div class="attGrid"><div class="att"><b>'+esc(student.school_name||'—')+'</b><span class="muted">Avtoshkola</span></div><div class="att"><b>'+esc(student.group_name||'—')+'</b><span class="muted">Guruh</span></div><div class="att"><b>'+esc(student.plate||'—')+'</b><span class="muted">Avtomobil</span></div><div class="att"><b>'+n+'</b><span class="muted">Kelgan dars</span></div></div></div>';
  }
  async function searchStudent(value){
    const q=norm(value);
    if(!q){ if($('studentId'))$('studentId').value=''; if($('studentBox'))$('studentBox').innerHTML=''; renderNames(''); return; }
    await loadStudents();
    renderNames(value);
    const schoolId=String($('school')?.value||'');
    const pool=allStudents.filter(s=>!schoolId||String(s.school_id||'')===schoolId);
    const exact=pool.filter(s=>norm(s.full_name)===q);
    const matches=exact.length?exact:pool.filter(s=>norm(s.full_name).includes(q));
    if(matches.length===1) await fillStudent(matches[0]);
    else if(matches.length>1) $('studentBox').innerHTML='<div class="attendance"><b>'+matches.length+' ta o‘quvchi topildi.</b><div class="muted" style="margin-top:6px">Ism-familiyaning to‘liqroq qismini yozing.</div></div>';
  }
  function bindStudent(){
    const el=$('student'); if(!el||el.dataset.fixBound)return; el.dataset.fixBound='1'; el.disabled=false;
    el.addEventListener('input',()=>{clearTimeout(studentTimer);const v=el.value;studentTimer=setTimeout(()=>searchStudent(v),120)});
    el.addEventListener('change',()=>searchStudent(el.value));
  }

  // The operator flow uses school + student. Group is kept internally only.
  function hideOperatorGroup(){
    const field=$('group')?.closest('.fg');
    if(field) field.style.display='none';
  }

  // Replace V3 start payload so group is inferred from selected student and plate parsing is correct.
  window.v3StartPayload=function(){
    const body=String($('plateBody')?.value||'').replace(/\s+/g,'').toUpperCase();
    const p=window.parsePlate(body); if(!p) throw Error('Raqamni 111AAA, 444WWW yoki A555AA ko‘rinishida kiriting.');
    const type=$('type')?.value||'ordinary';
    const h=Math.max(0,Math.floor(Number($('plannedHours')?.value||0)));
    const m=Math.max(0,Math.min(59,Math.floor(Number($('plannedMinutes')?.value||0))));
    const plannedMinutes=h*60+m; if(plannedMinutes<=0) throw Error('Avtodromda bo‘lish vaqtini kiriting.');
    const b={regionCode:$('region')?.value||'',plateBody:p.body,firstLetter:p.firstLetter,number:p.number,lastLetters:p.lastLetters,model:$('model')?.value.trim()||'',driverName:$('driver')?.value.trim()||'',plannedMinutes,durationMinutes:plannedMinutes,instructorId:$('v3Instructor')?.value||null,customerType:type};
    if(type==='school'){
      const sid=String($('studentId')?.value||''); if(!sid) throw Error('O‘quvchini ism-familiyasi bilan tanlang.');
      const st=allStudents.find(x=>String(x.id)===sid);
      const schoolId=String($('school')?.value||st?.school_id||'');
      if(!schoolId) throw Error('Avtoshkolani tanlang yoki o‘quvchini to‘liq tanlang.');
      if(st?.school_id&&String(st.school_id)!==schoolId) throw Error('Tanlangan o‘quvchi ushbu avtoshkolaga tegishli emas.');
      b.schoolId=schoolId; b.groupId=st?.group_id||$('group')?.value||null; b.studentId=sid;
    }
    return b;
  };

  // Stop the noisy broken vehicle-lookup endpoint; vehicle data can still be typed manually.
  window.v3LookupVehicle=async function(){ return null; };

  // Instructor dialog: school only. Group is not required.
  window.v3InstructorModal=async function(editId){
    let list=[]; try{const x=await window.api('/instructors'); list=Array.isArray(x)?x:(x?.items||x?.instructors||[]);}catch{}
    window.V3=window.V3||{}; window.V3.instructors=list;
    let schools=[]; try{schools=await window.api('/schools')||[];}catch{}
    const x=list.find(i=>String(i.id)===String(editId))||{};
    const options='<option value="">Avtoshkolani tanlang</option>'+schools.slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'uz',{sensitivity:'base'})).map(s=>'<option value="'+esc(s.id)+'" '+(String(s.id)===String(x.school_id)?'selected':'')+'>'+esc(s.name)+'</option>').join('');
    window.modal('<div class="modalHead"><div><h2 style="margin:0">'+(editId?'Instruktorni tahrirlash':'Instruktor qo‘shish')+'</h2><div class="muted">Avtoshkolani tanlash yetarli. ID avtomatik yaratiladi.</div></div><button class="btn light" type="button" onclick="closeModal()">Yopish</button></div><div class="formGrid"><div class="fg"><label>F.I.Sh.</label><input id="v3iName" value="'+esc(x.full_name||x.name||'')+'" placeholder="Aliyev Ali"></div><div class="fg"><label>Telefon</label><input id="v3iPhone" value="'+esc(x.phone||'')+'" type="tel" placeholder="+998..."></div><div class="fg"><label>Avtoshkola</label><select id="v3iSchool">'+options+'</select></div><div class="fg"><label>Avtomobil raqami</label><input id="v3iPlate" value="'+esc(x.vehicle_plate||'')+'" placeholder="01 A 555 AA"></div><div class="fg"><label>Avtomobil rusumi</label><input id="v3iModel" value="'+esc(x.vehicle_model||'')+'" placeholder="Chevrolet Cobalt"></div><div class="fg"><label>Holati</label><select id="v3iActive"><option value="true" '+(x.active!==false?'selected':'')+'>Faol</option><option value="false" '+(x.active===false?'selected':'')+'>Nofaol</option></select></div></div><div class="actions"><button class="btn green" type="button" onclick="v3SaveInstructor(\''+esc(editId||'')+'\')">Saqlash</button><button class="btn light" type="button" onclick="closeModal()">Bekor</button></div><div id="v3iErr" class="err"></div>');
  };
  window.v3SaveInstructor=async function(id){
    const err=$('v3iErr'); try{
      const payload={fullName:$('v3iName').value.trim(),phone:$('v3iPhone').value.trim(),schoolId:$('v3iSchool').value,groupId:null,vehiclePlate:$('v3iPlate').value.trim(),vehicleModel:$('v3iModel').value.trim(),active:$('v3iActive').value==='true'};
      if(!payload.fullName)return err.textContent='F.I.Sh. kerak.';
      if(!payload.schoolId)return err.textContent='Avtoshkolani tanlang.';
      await window.api(id?'/instructors/'+encodeURIComponent(id):'/instructors',{method:id?'PUT':'POST',body:JSON.stringify(payload)});
      window.closeModal(); await window.v3LoadInstructors(); window.showToast('Instruktor saqlandi.');
    }catch(e){if(err)err.textContent=e.message||'Saqlashda xatolik.';}
  };

  window.v3BulkInstructorModal=function(){ window.v3InstructorModal(); };

  const oldSchool=window.schoolMode;
  window.schoolMode=function(){ if(typeof oldSchool==='function') oldSchool(); hideOperatorGroup(); bindStudent(); loadStudents(); renderNames($('student')?.value||''); };
  const oldGo=window.go;
  window.go=function(page){ if(typeof oldGo==='function')oldGo(page); if(page==='add')setTimeout(()=>{hideOperatorGroup();bindStudent();loadStudents();renderNames($('student')?.value||'')},80); };

  setTimeout(()=>{
    hideOperatorGroup(); bindStudent(); loadStudents(); renderNames($('student')?.value||'');
    if($('school')) $('school').addEventListener('change',()=>{renderNames($('student')?.value||'');searchStudent($('student')?.value||'')});
  },20);
})();
