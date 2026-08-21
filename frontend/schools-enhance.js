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
})();
