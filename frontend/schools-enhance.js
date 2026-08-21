(function(){
  const escx = window.esc || (s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])));
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

  window.toggleSchoolTree = async function(id){
    if(schoolOpen.has(id)) schoolOpen.delete(id); else schoolOpen.add(id);
    if(schoolOpen.has(id)) { try { await getGroups(id); } catch(e) { toast(e.message,true); } }
    await renderSchoolTree();
  };

  window.toggleGroupTree = async function(schoolId, groupId){
    const key = schoolId+'|'+groupId;
    if(groupOpen.has(key)) groupOpen.delete(key); else {
      groupOpen.add(key);
      try { await getStudents(schoolId, groupId); } catch(e) { toast(e.message,true); }
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
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--b)">
          <div class="muted" style="font-weight:800;margin-bottom:8px">GURUHLAR — ${s.group_count||0} TA</div>
          ${gs.length ? gs.map(g=>{
            const key=s.id+'|'+g.id, go=groupOpen.has(key), ss=studentCache.get(key)||[];
            return `<div class="card" style="box-shadow:none;margin:7px 0;padding:11px;cursor:pointer" onclick="toggleGroupTree('${s.id}','${g.id}')">
              <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
                <div><b>${escx(g.name)}</b><div class="muted">${g.student_count||0} nafar o‘quvchi</div></div>
                <span class="badge">${go?'▲ Yopish':'▼ O‘quvchilar'}</span>
              </div>
              ${go ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--b)" onclick="event.stopPropagation()">
                ${ss.length ? ss.map(st=>`<div style="padding:9px 0;border-bottom:1px solid #edf3f0;display:flex;justify-content:space-between;gap:10px">
                  <div><b>${escx(st.full_name)}</b><div class="muted">${escx(st.plate||'Avtomobil biriktirilmagan')}</div></div>
                  <span class="badge">${st.attendance_count||0} marta</span>
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
    }catch(e){ toast(e.message,true); }
  };

  /* ============================================================
     KUNLIK HISOBOT -> EXCEL
     Avtoshkola o‘quvchisi bo‘lgan qatorlar SARIQ rangda chiqadi.
     Oddiy mijozlar odatdagi rangda qoladi.
     ============================================================ */
  function isSchoolRow(r){
    return !!(r && (r.student_id || r.studentId || r.school_id || r.schoolId || r.school_name || r.student_name));
  }

  function excelSafe(v){
    return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  window.exportCSV = function(){
    const rows = window.daily?.rows || [];
    if(!rows.length){
      if(typeof toast==='function') toast('Eksport uchun ma’lumot yo‘q',true);
      return;
    }

    const headers=['Raqam','Kirish','Chiqish','Davomiylik','Avtoshkola','Guruh','O‘quvchi','Jami','Naqd','Terminal','To‘lov turi'];
    const body=rows.map(r=>{
      const school=isSchoolRow(r);
      const style=school
        ? 'background-color:#fff2a8;mso-pattern:auto;color:#111111;'
        : '';
      return `<tr style="${style}">
        <td>${excelSafe(r.plate)}</td>
        <td>${excelSafe(dt(r.started_at))}</td>
        <td>${excelSafe(dt(r.finished_at))}</td>
        <td>${excelSafe(dur(r.duration_seconds))}</td>
        <td>${excelSafe(r.school_name||'')}</td>
        <td>${excelSafe(r.group_name||'')}</td>
        <td>${excelSafe(r.student_name||'')}</td>
        <td>${excelSafe(r.amount||0)}</td>
        <td>${excelSafe(r.cash_amount||0)}</td>
        <td>${excelSafe(r.terminal_amount||0)}</td>
        <td>${excelSafe(r.payment_method||'')}</td>
      </tr>`;
    }).join('');

    const html=`<!doctype html><html><head><meta charset="utf-8"><style>
      table{border-collapse:collapse;font-family:Arial,sans-serif;font-size:11pt}
      th,td{border:1px solid #b7c9c0;padding:7px 9px;white-space:nowrap}
      th{background:#087443;color:#fff;font-weight:bold}
    </style></head><body>
      <h2>AVTODROM — Kunlik hisobot</h2>
      <p>Sariq qator = avtoshkola o‘quvchisi</p>
      <table><thead><tr>${headers.map(h=>`<th>${excelSafe(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
    </body></html>`;

    const blob=new Blob(['\ufeff',html],{type:'application/vnd.ms-excel;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download='avtodrom-kunlik-hisobot-'+new Date().toISOString().slice(0,10)+'.xls';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    if(typeof toast==='function') toast('Excel tayyor. Avtoshkola o‘quvchilari sariq rangda belgilandi.');
  };

  /* Kunlik hisobot jadvalining o‘zida ham avtoshkola o‘quvchilarini sariq ko‘rsatamiz. */
  window.renderDailySchoolRows = function(rows){
    if(!rows || !rows.length) return '<div class="empty">Ma’lumot yo‘q</div>';
    return '<div class="tableWrap"><table class="table"><thead><tr><th>Raqam</th><th>Kirish</th><th>Chiqish</th><th>Vaqt</th><th>O‘quvchi</th><th>Naqd</th><th>Terminal</th><th>Jami</th></tr></thead><tbody>'+
      rows.map(r=>{
        const school=isSchoolRow(r);
        const style=school?'background:#fff2a8;':'';
        return `<tr style="${style}"><td><b>${escx(r.plate)}</b></td><td>${dt(r.started_at)}</td><td>${dt(r.finished_at)}</td><td>${dur(r.duration_seconds)}</td><td>${escx(r.student_name||'—')}</td><td>${money(r.cash_amount)}</td><td>${money(r.terminal_amount)}</td><td><b>${money(r.amount)}</b></td></tr>`;
      }).join('')+'</tbody></table></div>';
  };

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
      if($('dailyTable'))$('dailyTable').innerHTML=renderDailySchoolRows(daily.rows||[]);
    }catch(e){
      if(typeof toast==='function') toast(e.message,true);
      else if(oldLoadDaily) return oldLoadDaily();
    }
  };
})();
