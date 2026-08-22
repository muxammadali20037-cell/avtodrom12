(function(){
  'use strict';

  const escx = s => String(s ?? '').replace(/[&<>\"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[x]));

  function lessonsValue(){
    const el=document.getElementById('sLessons');
    return Math.max(0,Math.min(999,Math.floor(Number(el?.value||0))));
  }

  // O‘quvchi qo‘shishda aynan "Hozirgacha qatnashgan darslar soni" saqlanadi.
  window.createStudent = async function(){
    const n=document.getElementById('sn')?.value.trim();
    const phone=document.getElementById('sp')?.value.trim();
    const schoolId=document.getElementById('ss')?.value;
    const groupId=document.getElementById('sg')?.value||null;
    const plate=document.getElementById('spl')?.value.trim()||'';
    const attendanceCount=lessonsValue();

    if(!n||!schoolId){
      if(typeof showToast==='function')showToast('F.I.Sh. va avtoshkolani kiriting',true);
      return;
    }
    if(!phone){
      if(typeof showToast==='function')showToast('Telefon raqamini kiriting',true);
      return;
    }
    if(!groupId){
      if(typeof showToast==='function')showToast('Guruhni tanlang',true);
      return;
    }

    try{
      await api('/students',{method:'POST',body:JSON.stringify({fullName:n,phone,schoolId,groupId,plate,attendanceCount})});
      if(typeof closeModal==='function')closeModal();
      if(typeof adminLoad==='function')await adminLoad();
      if(typeof adminTab==='function')adminTab('students');
      if(typeof showToast==='function')showToast(n+' qo‘shildi — '+attendanceCount+' dars saqlandi');
    }catch(e){
      if(typeof showToast==='function')showToast(e.message||'O‘quvchini saqlashda xatolik',true);
    }
  };

  function getStudents(){return Array.isArray(window.students)?window.students:[];}

  function renderStudentOptions(){
    const el=document.getElementById('student');
    if(!el)return;
    const list=getStudents();
    if(!list.length)return;
    const current=el.value;
    el.innerHTML='<option value="">O‘quvchini tanlang</option>'+list.map(s=>
      '<option value="'+escx(s.id)+'">'+escx(s.full_name)+' — '+Number(s.attendance_count||0)+' dars'+(s.phone?' — '+escx(s.phone):'')+'</option>'
    ).join('');
    if(current && list.some(s=>String(s.id)===String(current)))el.value=current;
  }

  function renderSelectedStudent(){
    const el=document.getElementById('student');
    const box=document.getElementById('studentBox');
    if(!el||!box)return;
    const s=getStudents().find(x=>String(x.id)===String(el.value));
    if(!s){box.innerHTML='';return;}
    const n=Number(s.attendance_count||0);
    const cls=n>=12?'blue':n>=6?'red':'';
    const label=n<6?'1–5 normal':n<12?'6–11 nazorat':'12+ yangi bosqich';
    box.innerHTML='<div style="margin-top:12px;border:1px solid #dfeee8;border-radius:14px;padding:14px;background:#f8fcfa">'+
      '<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">'+
      '<div><b style="font-size:19px">'+escx(s.full_name)+'</b><div class="muted">📞 '+escx(s.phone||'Telefon yo‘q')+'</div><div class="muted">🚗 '+escx(s.plate||'Avtomobil biriktirilmagan')+'</div></div>'+ 
      '<div style="text-align:right"><span class="badge '+cls+'">'+n+' marta qatnashgan</span><div class="muted" style="margin-top:6px">'+label+'</div></div></div>'+ 
      '<div class="kv" style="margin-top:12px"><div><b>'+n+'</b><span>Kelgan dars</span></div><div><b>'+escx(s.group_name||'—')+'</b><span>Guruh</span></div><div><b>'+escx(s.school_name||'—')+'</b><span>Avtoshkola</span></div><div><b>BEPUL</b><span>Kirish turi</span></div></div></div>';
  }

  const group=document.getElementById('group');
  if(group)group.addEventListener('change',()=>{
    setTimeout(renderStudentOptions,200);
    setTimeout(renderStudentOptions,700);
  });

  const student=document.getElementById('student');
  if(student)student.addEventListener('change',renderSelectedStudent);

  setInterval(()=>{
    const el=document.getElementById('student');
    if(el && getStudents().length && el.options.length>1){
      const first=el.options[1]?.textContent||'';
      if(!first.includes(' dars'))renderStudentOptions();
    }
  },1000);
})();
