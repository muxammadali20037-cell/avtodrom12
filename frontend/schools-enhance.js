(function(){
  const escx = window.esc || (s=>String(s??'').replace(/[&<>\"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[x])));
  const schoolOpen = new Set();
  const groupOpen = new Set();
  const groupCache = new Map();
  const studentCache = new Map();

  async function getGroups(schoolId){
    if(!groupCache.has(schoolId)) groupCache.set(schoolId, await api('/groups?schoolId='+encodeURIComponent(schoolId)));
    return groupCache.get(schoolId) || [];
  }
  async function getStudents(schoolId, groupId){
    const key = schoolId+'|'+(groupId||'');
    if(!studentCache.has(key)) studentCache.set(key, await api('/students?schoolId='+encodeURIComponent(schoolId)+(groupId?'&groupId='+encodeURIComponent(groupId):'')));
    return studentCache.get(key) || [];
  }

  function historicalAttendance(s){
    const raw=String(s?.notes||'');
    const m=raw.match(/(?:^|;)ATTENDANCE_BASE=(\d+)(?:;|$)/i);
    const base=m?Number(m[1]):0;
    const sessions=Number(s?.attendance_count||0);
    return Math.max(0,Math.floor(base)+Math.floor(sessions));
  }
  function normalizeStudent(s){
    if(!s)return s;
    return {...s,attendance_count:historicalAttendance(s)};
  }
  function normalizeStudents(list){return (Array.isArray(list)?list:[]).map(normalizeStudent);}
  function studentAttendanceBadge(n){
    const cls=n>=12?'blue':n>=6?'red':'';
    const label=n<6?'1–5 normal':n<12?'6–11 nazorat':'12+ yangi bosqich';
    return '<span class="badge '+cls+'">'+n+' marta qatnashgan</span><div class="muted" style="margin-top:6px">'+label+'</div>';
  }

  window.toggleSchoolTree = async function(id){
    if(schoolOpen.has(id)) schoolOpen.delete(id); else schoolOpen.add(id);
    if(schoolOpen.has(id)) { try { await getGroups(id); } catch(e) { if(typeof showToast==='function')showToast(e.message,true); } }
    await renderSchoolTree();
  };

  window.toggleGroupTree = async function(schoolId, groupId){
    const key = schoolId+'|'+groupId;
    if(groupOpen.has(key)) groupOpen.delete(key); else {
      groupOpen.add(key);
      try { await getStudents(schoolId, groupId); } catch(e) { if(typeof showToast==='function')showToast(e.message,true); }
    }
    await renderSchoolTree();
  };

  async function renderSchoolTree(){
    const host = $('schoolCards');
    if(!host) return;
    host.innerHTML = schools.length ? schools.map(s=>{
      const opened = schoolOpen.has(s.id);
      const gs = groupCache.get(s.id) || [];
      const groupHtml = opened ? `
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid #dfeee8">
          <div class="muted" style="font-weight:800;margin-bottom:8px">GURUHLAR — ${s.group_count||0} TA</div>
          ${gs.length ? gs.map(g=>{
            const key=s.id+'|'+g.id, go=groupOpen.has(key), ss=normalizeStudents(studentCache.get(key)||[]);
            return `<div class="card" style="box-shadow:none;margin:7px 0;padding:11px;cursor:pointer" onclick="toggleGroupTree('${s.id}','${g.id}')">
              <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
                <div><b>${escx(g.name)}</b><div class="muted">${g.student_count||0} nafar o‘quvchi</div></div>
                <span class="badge">${go?'▲ Yopish':'▼ O‘quvchilar'}</span>
              </div>
              ${go ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid #edf3f0" onclick="event.stopPropagation()">
                ${ss.length ? ss.map(st=>`<div style="padding:10px 0;border-bottom:1px solid #edf3f0;display:flex;justify-content:space-between;gap:10px;align-items:center">
                  <div><b>${escx(st.full_name)}</b><div class="muted">📞 ${escx(st.phone||'Telefon yo‘q')}</div><div class="muted">🚗 ${escx(st.plate||'Avtomobil biriktirilmagan')}</div></div>
                  <div style="text-align:right">${studentAttendanceBadge(Number(st.attendance_count||0))}</div>
                </div>`).join('') : '<div class="empty" style="padding:12px">Bu guruhda o‘quvchi yo‘q</div>'}
              </div>`:''}
            </div>`;
          }).join('') : '<div class="empty" style="padding:12px">Guruh yo‘q</div>'}
          <button class="btn light" style="margin-top:8px" onclick="event.stopPropagation();groupModal('${s.id}')">＋ Guruh qo‘shish</button>
        </div>` : '';
      return `<div class="card click" onclick="toggleSchoolTree('${s.id}')">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
          <div><h3>${escx(s.name)}</h3><div class="muted">${escx(s.phone||'Telefon yo‘q')}</div></div>
          <span class="badge">${opened?'▲ Yopish':'▼ Ochish'}</span>
        </div>
        <div class="actions" onclick="event.stopPropagation()"><span class="badge">${s.group_count||0} guruh</span><span class="badge">${s.student_count||0} o‘quvchi</span><button class="btn light" onclick="groupModal('${s.id}')">＋ Guruh</button></div>
        ${groupHtml}
      </div>`;
    }).join('') : '<div class="empty">Avtoshkola yo‘q</div>';
    const gt=$('groupTable'); if(gt) gt.innerHTML='<div class="muted">Avtoshkolani bosing — guruhlar ochiladi. Guruhni bosing — o‘quvchilar ko‘rinadi.</div>';
  }

  window.loadSchools = async function(){
    try{
      schools = await api('/schools');
      groups = await api('/groups');
      groupCache.clear(); studentCache.clear();
      await renderSchoolTree();
    }catch(e){ if(typeof showToast==='function')showToast(e.message,true); }
  };

  function isSchoolRow(r){
    return !!(r && (r.student_id || r.studentId || r.school_id || r.schoolId || r.school_name || r.student_name));
  }
  function excelSafe(v){
    return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');
  }

  window.exportCSV = function(){
    const rows = (typeof daily !== 'undefined' && daily && daily.rows) ? daily.rows : [];
    if(!rows.length){
      if(typeof showToast==='function') showToast('Eksport uchun ma’lumot yo‘q',true);
      return;
    }
    const headers=['Raqam','Kirish','Chiqish','Davomiylik','Avtoshkola','Guruh','O‘quvchi','Jami','Naqd','Terminal','To‘lov turi'];
    const body=rows.map(r=>{
      const school=isSchoolRow(r), style=school?'background-color:#fff2a8;color:#111111;':'';
      return `<tr style="${style}"><td>${excelSafe(r.plate)}</td><td>${excelSafe(dt(r.started_at))}</td><td>${excelSafe(dt(r.finished_at))}</td><td>${excelSafe(dur(r.duration_seconds))}</td><td>${excelSafe(r.school_name||'')}</td><td>${excelSafe(r.group_name||'')}</td><td>${excelSafe(r.student_name||'')}</td><td>${excelSafe(r.amount||0)}</td><td>${excelSafe(r.cash_amount||0)}</td><td>${excelSafe(r.terminal_amount||0)}</td><td>${excelSafe(r.payment_method||'')}</td></tr>`;
    }).join('');
    const html=`<!doctype html><html><head><meta charset="utf-8"><style>table{border-collapse:collapse;font-family:Arial,sans-serif;font-size:11pt}th,td{border:1px solid #b7c9c0;padding:7px 9px;white-space:nowrap}th{background:#087443;color:#fff;font-weight:bold}</style></head><body><h2>AVTODROM — Kunlik hisobot</h2><p>Sariq qator = avtoshkola o‘quvchisi</p><table><thead><tr>${headers.map(h=>`<th>${excelSafe(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></body></html>`;
    const blob=new Blob(['\ufeff',html],{type:'application/vnd.ms-excel;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='avtodrom-kunlik-hisobot-'+new Date().toISOString().slice(0,10)+'.xls';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    if(typeof showToast==='function')showToast('Excel tayyor. Avtoshkola o‘quvchilari sariq rangda belgilandi.');
  };

  window.renderDailySchoolRows = function(rows){
    if(!rows || !rows.length) return '<div class="muted">Ma’lumot yo‘q</div>';
    return '<div class="tableWrap"><table class="table"><thead><tr><th>Raqam</th><th>Kirish</th><th>Chiqish</th><th>Vaqt</th><th>O‘quvchi</th><th>Kelgan dars</th><th>Naqd</th><th>Terminal</th><th>Jami</th></tr></thead><tbody>'+rows.map(r=>{
      const style=isSchoolRow(r)?'background:#fff2a8;':'';
      return `<tr style="${style}"><td><b>${escx(r.plate)}</b></td><td>${dt(r.started_at)}</td><td>${dt(r.finished_at)}</td><td>${dur(r.duration_seconds)}</td><td>${escx(r.student_name||'—')}</td><td>${r.student_name?Number(r.attendance_count||0):'—'}</td><td>${money(r.cash_amount)}</td><td>${money(r.terminal_amount)}</td><td><b>${money(r.amount)}</b></td></tr>`;
    }).join('')+'</tbody></table></div>';
  };

  /* ===== O‘QUVCHI QATNASHGAN DARS TARIXI ===== */
  window.createStudent = async function(){
    const n=$('sn')?.value.trim();
    const phone=$('sp')?.value.trim();
    const schoolId=$('ss')?.value;
    const groupId=$('sg')?.value||null;
    const plate=$('spl')?.value.trim();
    const lessons=Math.max(0,Math.min(999,Math.floor(Number($('sLessons')?.value||0))));
    if(!n||!schoolId){if(typeof showToast==='function')showToast('F.I.Sh. va avtoshkolani kiriting',true);return;}
    if(!phone){if(typeof showToast==='function')showToast('Telefon raqamini kiriting',true);return;}
    if(!groupId){if(typeof showToast==='function')showToast('Guruhni tanlang',true);return;}
    try{
      await api('/students',{method:'POST',body:JSON.stringify({
        fullName:n,phone,schoolId,groupId,plate,
        notes:'ATTENDANCE_BASE='+lessons
      })});
      closeModal();
      groupCache.clear();studentCache.clear();
      await adminLoad();
      adminTab('students');
      if(typeof showToast==='function')showToast(n+' qo‘shildi — '+lessons+' ta eski dars saqlandi');
    }catch(e){if(typeof showToast==='function')showToast(e.message,true);}
  };

  /* Operator panelidagi guruh -> o‘quvchi tanlovi */
  window.studentsForGroup = async function(){
    const s=$('school')?.value,g=$('group')?.value;if(!s||!g)return;
    try{
      students=normalizeStudents(await api('/students?schoolId='+encodeURIComponent(s)+'&groupId='+encodeURIComponent(g))||[]);
      $('student').innerHTML='<option value="">O‘quvchini tanlang</option>'+students.map(x=>'<option value="'+escx(x.id)+'">'+escx(x.full_name)+' — '+Number(x.attendance_count||0)+' marta</option>').join('');
      $('student').disabled=false;
      $('studentBox').innerHTML='<div class="muted" style="margin-top:8px">O‘quvchini tanlang — F.I.Sh., telefon va qatnashgan darslari shu yerda ko‘rinadi.</div>';
    }catch(e){if(typeof showToast==='function')showToast(e.message,true);}
  };

  window.studentInfo = function(){
    const s=(students||[]).find(x=>String(x.id)===String($('student')?.value));
    if(!s){$('studentBox').innerHTML='';return;}
    const n=Number(s.attendance_count||0);
    const cls=n>=12?'blue':n>=6?'red':'';
    const label=n<6?'1–5 normal':n<12?'6–11 nazorat':'12+ yangi bosqich';
    $('studentBox').innerHTML=`<div style="margin-top:12px;border:1px solid #dfeee8;border-radius:14px;padding:14px;background:#f8fcfa">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
        <div><b style="font-size:19px">${escx(s.full_name)}</b><div class="muted">📞 ${escx(s.phone||'Telefon yo‘q')}</div><div class="muted">🚗 ${escx(s.plate||'Avtomobil biriktirilmagan')}</div></div>
        <div style="text-align:right"><span class="badge ${cls}">${n} marta qatnashgan</span><div class="muted" style="margin-top:6px">${label}</div></div>
      </div>
      <div class="kv" style="margin-top:12px"><div><b>${n}</b><span>Kelgan dars</span></div><div><b>${escx(s.group_name||'—')}</b><span>Guruh</span></div><div><b>${escx(s.school_name||'—')}</b><span>Avtoshkola</span></div><div><b>BEPUL</b><span>Kirish turi</span></div></div>
    </div>`;
  };

  /* Admin ro‘yxatida ham tarixiy darslar ko‘rinsin */
  const originalAdminLoad=window.adminLoad;
  if(originalAdminLoad){
    window.adminLoad=async function(){
      await originalAdminLoad();
      try{students=normalizeStudents(students||[]);}catch{}
    };
  }

  const originalAdminShowStudents=window.adminShowStudents;
  if(originalAdminShowStudents){
    window.adminShowStudents=async function(gid){
      try{
        const arr=normalizeStudents(await api('/students?groupId='+encodeURIComponent(gid))||[]);
        const target=$('groupStudents_'+gid);
        const html=arr.length?'<div style="border-top:1px solid #dfeee8;padding-top:10px">'+arr.map(studentCardHTML).join('')+'</div>':'<div class="muted">Bu guruhda hali o‘quvchi yo‘q.</div>';
        if(target)target.innerHTML=html;
      }catch(e){if(typeof showToast==='function')showToast(e.message,true);}
    };
  }

  const originalAdminRenderStudents=window.adminRenderStudents;
  if(originalAdminRenderStudents){
    window.adminRenderStudents=function(){
      try{students=normalizeStudents(students||[]);}catch{}
      return originalAdminRenderStudents();
    };
  }

  /* Kunlik hisobotga ham qatnashgan dars sonini chiqaramiz */
  const oldLoadDaily=window.loadDaily;
  window.loadDaily=async function(){
    try{
      daily=await api('/reports/daily');
      const s=daily.summary||{};
      if($('rdc'))$('rdc').textContent=s.count||0;
      if($('rdm'))$('rdm').textContent=money(s.amount);
      if($('rdcash'))$('rdcash').textContent=money(s.cash);
      if($('rdterm'))$('rdterm').textContent=money(s.terminal);
      if($('rdtime'))$('rdtime').textContent=dur((daily.rows||[]).reduce((a,x)=>a+Number(x.duration_seconds||0),0));
      const host=$('dailyTableWrap');
      if(host)host.innerHTML=tableHTML(daily.rows||[]);
    }catch(e){
      if(typeof showToast==='function')showToast(e.message,true);
      else if(oldLoadDaily) return oldLoadDaily();
    }
  };

  /* Mavjud kod group change eventini oldin bog‘lagan bo‘lishi mumkin.
     Event listener funksiyani reference orqali chaqirgani uchun override qilingan
     window.studentsForGroup yangi tanlovlarda ishlaydi. */
})();
