import { readFile } from 'node:fs/promises';

const frontendFile = new URL('../frontend/index.html', import.meta.url);

function cleanLegacyScripts(html) {
  return String(html || '')
    .replace(/<script\s+src=["']\/(?:restore-features|queue-fix|student-attendance-fix|schools-enhance|students-enhance|student-plate-instructor-fix|runtime-relations-fix)\.js["']\s*><\/script>/gi, '');
}

function repairKnownInlineSyntax(html) {
  let source = String(html || '');
  const start = source.indexOf('function exportExcel(){');
  const end = source.indexOf('async function historySearch(){', start);
  if (start >= 0 && end > start) {
    const safeExport = `function exportExcel(){
  const rows=daily?.rows||[];
  if(!rows.length){showToast('Eksport uchun ma’lumot yo‘q',true);return;}
  const headers=['Raqam','Kirish','Chiqish','Vaqt','Avtoshkola','Guruh','O‘quvchi','Kelgan dars','Naqd','Terminal','Jami'];
  const body=rows.map(r=>{const att=Number(r.attendance_count||0);const values=[r.plate||'',dt(r.started_at),dt(r.finished_at),dur(r.duration_seconds),r.school_name||'',r.group_name||'',r.student_name||'',r.student_name?att:'',Number(r.cash_amount||0),Number(r.terminal_amount||0),Number(r.amount||0)];return '<tr>'+values.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>';}).join('');
  const head=headers.map(v=>'<th>'+esc(v)+'</th>').join('');
  const htmlOut='<!doctype html><html><head><meta charset="utf-8"><style>table{border-collapse:collapse;font-family:Arial}th,td{border:1px solid #999;padding:6px;white-space:nowrap}th{background:#e8f4ee}</style></head><body><table><tr>'+head+'</tr>'+body+'</table></body></html>';
  const blob=new Blob(['\\ufeff',htmlOut],{type:'application/vnd.ms-excel;charset=utf-8'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='avtodrom-'+(($('reportDate')&&$('reportDate').value)||localDateISO(0))+'.xls';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}`;
    source = source.slice(0,start) + safeExport + '\n' + source.slice(end);
  }
  return source;
}

const instructorOnlySchoolFix = String.raw`<script>
/* ===== INSTRUCTOR: SCHOOL ONLY =====
   Deliberately isolated: no group field, no group API, no vehicle FK column. */
(function(){
  'use strict';
  const escx = v => String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const modalx = c => { if (typeof window.modal === 'function') window.modal(c); };
  const getSchools = async () => {
    if (Array.isArray(window.schools) && window.schools.length) return window.schools;
    const x = await window.api('/schools');
    window.schools = Array.isArray(x) ? x : [];
    return window.schools;
  };
  const sortSchools = xs => xs.slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'uz',{sensitivity:'base'}));

  window.v3InstructorModal = async function(editId){
    const list = Array.isArray(window.V3?.instructors) ? window.V3.instructors : [];
    const x = list.find(i => String(i.id) === String(editId)) || {};
    let schools = [];
    try { schools = await getSchools(); } catch(e) { if(typeof window.showToast==='function') window.showToast(e.message,true); }

    const schoolOptions = '<option value="">Avtoshkolani tanlang</option>' + sortSchools(schools).map(s =>
      '<option value="'+escx(s.id)+'" '+(String(s.id)===String(x.school_id||'')?'selected':'')+'>'+escx(s.name)+'</option>'
    ).join('');

    modalx(
      '<div class="modalHead"><div>'+
        '<h2 style="margin:0">'+(editId?'Instruktorni tahrirlash':'Instruktor qo‘shish')+'</h2>'+
        '<div class="muted">Instruktorga faqat avtoshkola biriktiriladi. Guruh talab qilinmaydi.</div>'+
      '</div><button class="btn light" type="button" onclick="closeModal()">Yopish</button></div>'+
      '<div class="formGrid">'+
        '<div class="fg"><label>F.I.Sh.</label><input id="v3iName" value="'+escx(x.full_name||x.name||'')+'" placeholder="Aliyev Ali"></div>'+
        '<div class="fg"><label>Telefon</label><input id="v3iPhone" value="'+escx(x.phone||'')+'" placeholder="+998..." type="tel"></div>'+
        '<div class="fg span2"><label>Avtoshkola</label><select id="v3iSchool">'+schoolOptions+'</select></div>'+
        '<div class="fg"><label>Avtomobil raqami</label><input id="v3iPlate" value="'+escx(x.vehicle_plate||'')+'" placeholder="01 A 555 AA"></div>'+
        '<div class="fg"><label>Avtomobil rusumi</label><input id="v3iModel" value="'+escx(x.vehicle_model||'')+'" placeholder="Chevrolet Cobalt"></div>'+
        '<div class="fg"><label>Holati</label><select id="v3iActive"><option value="true" '+(x.active!==false?'selected':'')+'>Faol</option><option value="false" '+(x.active===false?'selected':'')+'>Nofaol</option></select></div>'+
        '<div class="fg"><label>Biriktirish</label><div class="v3-note">Avtomobil bazadagi mavjud mashinadan tanlanadi. Bir avtomobil faqat bitta faol instruktorga tegishli bo‘ladi.</div></div>'+
      '</div>'+ 
      '<div class="actions"><button class="btn green" type="button" onclick="v3SaveInstructor(\\''+escx(editId||'')+'\\')">Saqlash</button><button class="btn light" type="button" onclick="closeModal()">Bekor</button></div>'+ 
      '<div id="v3iErr" class="err"></div>'
    );
  };

  window.v3SaveInstructor = async function(id){
    const err = document.getElementById('v3iErr');
    if(err) err.textContent='';
    const payload = {
      fullName: document.getElementById('v3iName')?.value.trim() || '',
      phone: document.getElementById('v3iPhone')?.value.trim() || '',
      schoolId: document.getElementById('v3iSchool')?.value || '',
      vehiclePlate: document.getElementById('v3iPlate')?.value.trim() || '',
      vehicleModel: document.getElementById('v3iModel')?.value.trim() || '',
      active: document.getElementById('v3iActive')?.value === 'true'
    };
    if(!payload.fullName){ if(err)err.textContent='F.I.Sh. kerak'; return; }
    if(!payload.schoolId){ if(err)err.textContent='Avtoshkolani tanlang'; return; }
    try{
      await window.api(id ? '/instructors/'+encodeURIComponent(id) : '/instructors', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(payload)
      });
      if(typeof window.closeModal==='function') window.closeModal();
      if(typeof window.v3LoadInstructors==='function') await window.v3LoadInstructors();
      if(typeof window.showToast==='function') window.showToast('Instruktor saqlandi.');
    }catch(e){ if(err) err.textContent=e.message||'Instruktor saqlanmadi'; }
  };

  window.v3BulkInstructorModal = async function(){
    let schools=[];
    try{ schools=await getSchools(); }catch(e){ if(typeof window.showToast==='function')window.showToast(e.message,true); return; }
    const opts='<option value="">Avtoshkolani tanlang</option>'+sortSchools(schools).map(s=>'<option value="'+escx(s.id)+'">'+escx(s.name)+'</option>').join('');
    modalx('<div class="modalHead"><div><h2 style="margin:0">Instruktorlarni ommaviy qo‘shish</h2><div class="muted">Har qatorda: F.I.Sh. | telefon | avtomobil raqami | rusum</div></div><button class="btn light" type="button" onclick="closeModal()">Yopish</button></div><div class="fg"><label>Avtoshkola</label><select id="v3BulkSchool">'+opts+'</select></div><div class="fg"><textarea id="v3iBulk" rows="9" style="width:100%;padding:12px;border:1px solid var(--line);border-radius:10px" placeholder="Aliyev Ali | +998901112233 | 01 A 555 AA | Chevrolet Cobalt"></textarea></div><div class="actions"><button class="btn green" type="button" onclick="v3SaveBulkInstructors()">Saqlash</button><button class="btn light" type="button" onclick="closeModal()">Bekor</button></div><div id="v3iBulkErr" class="err"></div>');
  };

  window.v3SaveBulkInstructors = async function(){
    const lines=String(document.getElementById('v3iBulk')?.value||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    const schoolId=document.getElementById('v3BulkSchool')?.value||'';
    const err=document.getElementById('v3iBulkErr');
    if(!schoolId){if(err)err.textContent='Avtoshkolani tanlang';return;}
    if(!lines.length){if(err)err.textContent='Kamida bitta instruktor kiriting';return;}
    try{
      for(const line of lines){
        const p=line.split('|').map(x=>x.trim());
        if(!p[0])continue;
        await window.api('/instructors',{method:'POST',body:JSON.stringify({fullName:p[0],phone:p[1]||'',schoolId,vehiclePlate:p[2]||'',vehicleModel:p[3]||'',active:true})});
      }
      if(typeof window.closeModal==='function')window.closeModal();
      if(typeof window.v3LoadInstructors==='function')await window.v3LoadInstructors();
      if(typeof window.showToast==='function')window.showToast(lines.length+' ta instruktor qo‘shildi.');
    }catch(e){if(err)err.textContent=e.message||'Ommaviy qo‘shishda xatolik';}
  };

  /* Prevent old wrapper code from trying to depend on an undefined instructor renderer. */
  if(typeof window.v3RenderAdminInstructors!=='function'){
    window.v3RenderAdminInstructors=function(){
      const boxes=[document.getElementById('v3InstructorList'),document.getElementById('v3AdminInstructorList')].filter(Boolean);
      const list=Array.isArray(window.V3?.instructors)?window.V3.instructors:[];
      boxes.forEach(box=>{
        box.innerHTML=list.length?list.map(i=>'<div class="card"><h3>'+escx(i.full_name||i.name||'Instruktor')+'</h3><div class="muted">📞 '+escx(i.phone||'—')+'</div><div class="muted">🚗 '+escx(i.vehicle_plate||'Biriktirilmagan')+'</div></div>').join(''):'<div class="muted">Instruktor yo‘q.</div>';
      });
    };
  }
})();
</script>`;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Method ruxsat etilmagan' }));
    return;
  }

  try {
    let html = await readFile(frontendFile, 'utf8');
    html = cleanLegacyScripts(html);
    html = repairKnownInlineSyntax(html);
    if (!html.includes('INSTRUCTOR: SCHOOL ONLY')) {
      html = html.replace('</body>', instructorOnlySchoolFix + '</body>');
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('X-Avtodrom-Frontend', 'instructor-school-only');
    return res.end(html);
  } catch (error) {
    console.error('FRONTEND SERVE ERROR:', error?.message || error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Frontend yuklanmadi' }));
  }
}
