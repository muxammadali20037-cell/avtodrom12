/* AVTODROM legacy features restore — safe version */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const token = () => localStorage.getItem('avtodrom_token') || '';
  const escx = s => String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
  const toast = (m, err=false) => {
    if (typeof window.showToast === 'function') window.showToast(m, err);
    else alert(m);
  };
  const rapi = async (path, opt={}) => {
    const res = await fetch('/api/restore' + path, {
      ...opt,
      headers: {
        'Content-Type':'application/json',
        ...(token() ? {Authorization:'Bearer '+token()} : {}),
        ...(opt.headers || {})
      }
    });
    const text = await res.text();
    let data={}; try { data=text ? JSON.parse(text) : {}; } catch { data={error:text}; }
    if(!res.ok) throw Error(data.error || data.message || ('Server xatosi: '+res.status));
    return data;
  };
  const baseLessons = s => {
    const m = String(s?.notes || '').match(/ATTENDANCE_BASE\s*=\s*(\d+)/i);
    return m ? Number(m[1]) : 0;
  };
  const lessons = s => baseLessons(s) + Number(s?.attendance_count || 0);

  function parsePlate(region, raw) {
    const b = String(raw || '').toUpperCase().replace(/\s+/g,'');
    if(!['01','10','20','25','30','40','50','60','70','75','80','85','90','95'].includes(String(region))) return null;
    if(!/^(?:[A-Z]\d{3}[A-Z]{2}|\d{3}[A-Z]{3})$/.test(b)) return null;
    if(/^[A-Z]\d{3}[A-Z]{2}$/.test(b))
      return {regionCode:String(region),plateBody:b,plate:b,firstLetter:b[0],number:b.slice(1,4),lastLetters:b.slice(4)};
    return {regionCode:String(region),plateBody:b,plate:b,firstLetter:b[3],number:b.slice(0,3),lastLetters:b.slice(4)};
  }

  function installStartOverride(){
    const form=$('startForm');
    if(!form || form.dataset.restoreSafe==='1') return;
    form.dataset.restoreSafe='1';
    form.addEventListener('submit', async e=>{
      e.preventDefault(); e.stopImmediatePropagation();
      const p=parsePlate($('region')?.value,$('plateBody')?.value);
      $('plateErr').textContent=''; $('startErr').textContent='';
      if(!p){$('plateErr').textContent='Raqam noto‘g‘ri. Masalan A555AA yoki 444WWW.';return;}
      const b={...p,model:$('model')?.value.trim(),driverName:$('driver')?.value.trim()};
      if($('type')?.value==='school'){
        if(!$('school')?.value || !$('student')?.value){$('startErr').textContent='Avtoshkola va o‘quvchini tanlang.';return;}
        b.schoolId=$('school').value; b.groupId=$('group').value||null; b.studentId=$('student').value;
      }
      const btn=$('startBtn'); if(btn){btn.disabled=true;btn.textContent='Saqlanmoqda...';}
      try{
        const x=await rapi('/start',{method:'POST',body:JSON.stringify(b)});
        toast((x.plate||($('region').value+' '+p.plateBody))+' uchun vaqt ochildi.');
        if(typeof window.resetStart==='function') window.resetStart();
        if(typeof window.loadActive==='function') await window.loadActive(true);
        if(typeof window.go==='function') window.go('active');
      }catch(err){$('startErr').textContent=err.message;}
      finally{if(btn){btn.disabled=false;btn.textContent='▶ Vaqt ochish';}}
    },true);
  }

  async function collectStartData(){
    const p=parsePlate($('region')?.value,$('plateBody')?.value);
    if(!p) throw Error('Raqam noto‘g‘ri. Masalan A555AA yoki 444WWW.');
    const b={...p,model:$('model')?.value.trim(),driverName:$('driver')?.value.trim()};
    if($('type')?.value==='school'){
      if(!$('school')?.value || !$('student')?.value) throw Error('Avtoshkola va o‘quvchini tanlang.');
      b.schoolId=$('school').value;b.groupId=$('group').value||null;b.studentId=$('student').value;
    }
    return b;
  }

  function installWaitingUI(){
    const side=$('side');
    if(side && !$('nav-waiting')){
      const b=document.createElement('button');
      b.id='nav-waiting'; b.className='nav'; b.dataset.p='waiting';
      b.innerHTML='⏳ &nbsp; Kutish rejimi <span id="waitingCount"></span>';
      const frozen=side.querySelector('[data-p="frozen"]');
      if(frozen) frozen.insertAdjacentElement('afterend',b); else side.appendChild(b);
      b.onclick=goWaiting;
    }
    if(!$('p-waiting')){
      const sec=document.createElement('section');
      sec.id='p-waiting'; sec.className='page hidden';
      sec.innerHTML='<div class="head"><div><h1>Kutish rejimi</h1><p>Keyingi avtomobil navbatda turadi. Oldingisi tugagach navbatdagi avtomobil avtomatik vaqt ochadi.</p></div><button class="btn green" id="waitRefresh">↻ Yangilash</button></div><div class="panel" id="waitingList"></div>';
      document.querySelector('.content')?.appendChild(sec);
      $('waitRefresh').onclick=loadWaiting;
    }
    const actions=document.querySelector('#p-add .actions');
    if(actions && !$('waitAddBtn')){
      const b=document.createElement('button');
      b.type='button';b.id='waitAddBtn';b.className='btn light';
      b.textContent='⏳ Kutish rejimiga qo‘shish';b.onclick=addWaiting;
      actions.insertBefore(b, actions.querySelector('button') || null);
    }
  }

  function goWaiting(){
    document.querySelectorAll('.page').forEach(x=>x.classList.add('hidden'));
    $('p-waiting')?.classList.remove('hidden');
    if($('pageTitle')) $('pageTitle').textContent='Kutish rejimi';
    document.querySelectorAll('.nav[data-p]').forEach(x=>x.classList.toggle('active',x.dataset.p==='waiting'));
    loadWaiting();
  }

  async function addWaiting(){
    try{
      const b=await collectStartData();
      const x=await rapi('/waiting',{method:'POST',body:JSON.stringify(b)});
      toast(x.plate+' kutish navbatiga qo‘shildi.');
      if(typeof window.resetStart==='function') window.resetStart();
      await loadWaiting();
      await promote();
    }catch(e){if($('startErr')) $('startErr').textContent=e.message;}
  }

  async function loadWaiting(){
    if(!token()) return;
    try{
      const list=await rapi('/waiting');
      if($('waitingCount')) $('waitingCount').textContent=list.length?' ('+list.length+')':'';
      const box=$('waitingList'); if(!box) return;
      box.innerHTML=list.length ? list.map((x,i)=>{
        const time=x.created_at ? new Date(x.created_at).toLocaleTimeString('uz-UZ',{hour:'2-digit',minute:'2-digit'}) : '—';
        const who=x.student_name ? escx(x.school_name||'')+' • '+escx(x.group_name||'')+' • '+escx(x.student_name) : 'Oddiy mijoz';
        return '<div class="vehicle" style="display:flex;justify-content:space-between;gap:14px;align-items:center;flex-wrap:wrap">'+
          '<div><div class="plateText">#'+(i+1)+' &nbsp; '+escx(x.plate)+'</div>'+
          '<div class="muted">'+escx(x.model||'')+(x.driver_name?' • '+escx(x.driver_name):'')+'</div>'+
          '<div class="muted">'+who+' • qo‘shilgan '+time+'</div></div>'+
          '<div class="vActions"><button class="btn green" onclick="restoreStartWaiting(\''+escx(x.id)+'\')">▶ Vaqt ochish</button><button class="btn red" onclick="restoreDeleteWaiting(\''+escx(x.id)+'\')">✕ O‘chirish</button></div></div>';
      }).join('') : '<div class="muted">Kutish navbatida avtomobil yo‘q.</div>';
    }catch(e){toast(e.message,true);}
  }

  window.restoreStartWaiting=async id=>{
    try{
      const x=await rapi('/waiting/'+encodeURIComponent(id)+'/start',{method:'POST'});
      toast(x.plate+' uchun vaqt ochildi.');
      await loadWaiting(); if(typeof window.loadActive==='function') await window.loadActive(true);
      if(typeof window.go==='function') window.go('active');
    }catch(e){toast(e.message,true);}
  };
  window.restoreDeleteWaiting=async id=>{
    if(!confirm('Bu avtomobilni kutish navbatidan o‘chirasizmi?')) return;
    try{await rapi('/waiting/'+encodeURIComponent(id),{method:'DELETE'});await loadWaiting();toast('Kutish navbatidan o‘chirildi.');}
    catch(e){toast(e.message,true);}
  };

  async function promote(){
    try{
      const activeList=Array.isArray(window.active)?window.active:[];
      if(activeList.length) return;
      const x=await rapi('/waiting/promote',{method:'POST'});
      if(x.started){
        toast(x.plate+' — navbatdan avtomatik vaqt ochildi.');
        await loadWaiting();
        if(typeof window.loadActive==='function') await window.loadActive(true);
      }
    }catch(_){ }
  }

  const schools=()=>Array.isArray(window.schools)?window.schools:[];
  const groups=()=>Array.isArray(window.groups)?window.groups:[];
  const students=()=>Array.isArray(window.students)?window.students:[];
  function modal(content){ if(typeof window.modal==='function') window.modal(content); }
  function closeModal(){ if(typeof window.closeModal==='function') window.closeModal(); }

  window.restoreEditSchool=id=>{
    const s=schools().find(x=>String(x.id)===String(id)); if(!s)return;
    modal('<h2>Avtoshkolani tahrirlash</h2><div class="fg"><label>Nomi</label><input id="rsName" value="'+escx(s.name)+'"></div><div class="fg"><label>Telefon</label><input id="rsPhone" value="'+escx(s.phone||'')+'"></div><div class="fg"><label>Izoh</label><input id="rsNotes" value="'+escx(s.notes||'')+'"></div><div class="actions"><button class="btn green" onclick="restoreSaveSchool(\''+escx(s.id)+'\')">Saqlash</button><button class="btn light" onclick="closeModal()">Bekor</button></div>');
  };
  window.restoreSaveSchool=async id=>{
    try{await rapi('/schools/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({name:$('rsName').value.trim(),phone:$('rsPhone').value.trim(),notes:$('rsNotes').value.trim()})});closeModal();await window.adminLoad();window.adminTab('schools');toast('Avtoshkola tahrirlandi.');}
    catch(e){toast(e.message,true);}
  };
  window.restoreDeleteSchool=async id=>{
    if(!confirm('Avtoshkolani o‘chirish kerakmi?'))return;
    try{await rapi('/schools/'+encodeURIComponent(id),{method:'DELETE'});await window.adminLoad();window.adminTab('schools');toast('Avtoshkola o‘chirildi.');}
    catch(e){toast(e.message,true);}
  };

  window.restoreEditGroup=id=>{
    const g=groups().find(x=>String(x.id)===String(id));if(!g)return;
    modal('<h2>Guruhni tahrirlash</h2><div class="fg"><label>Nomi</label><input id="rgName" value="'+escx(g.name)+'"></div><div class="actions"><button class="btn green" onclick="restoreSaveGroup(\''+escx(g.id)+'\')">Saqlash</button><button class="btn light" onclick="closeModal()">Bekor</button></div>');
  };
  window.restoreSaveGroup=async id=>{
    try{await rapi('/groups/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({name:$('rgName').value.trim()})});closeModal();await window.adminLoad();window.adminTab('schools');toast('Guruh tahrirlandi.');}
    catch(e){toast(e.message,true);}
  };
  window.restoreDeleteGroup=async id=>{
    if(!confirm('Guruhni o‘chirish kerakmi?'))return;
    try{await rapi('/groups/'+encodeURIComponent(id),{method:'DELETE'});await window.adminLoad();window.adminTab('schools');toast('Guruh o‘chirildi.');}
    catch(e){toast(e.message,true);}
  };

  function renderSchools(){
    const box=$('adminSchoolCards');if(!box)return;
    box.innerHTML=schools().length ? schools().map(s=>{
      const gc=groups().filter(g=>String(g.school_id)===String(s.id)).length;
      return '<div class="card"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"><div><h3>'+escx(s.name)+'</h3><div class="muted">📞 '+escx(s.phone||'Telefon yo‘q')+'</div><div style="margin-top:8px"><span class="badge">'+Number(s.group_count||gc)+' guruh</span> <span class="badge">'+Number(s.student_count||0)+' o‘quvchi</span></div></div><div class="actions"><button class="btn light" onclick="restoreShowGroups(\''+escx(s.id)+'\')">Guruhlar</button><button class="btn green" onclick="groupModal(\''+escx(s.id)+'\')">＋ Guruh</button><button class="btn light" onclick="restoreEditSchool(\''+escx(s.id)+'\')">✎ Tahrirlash</button><button class="btn red" onclick="restoreDeleteSchool(\''+escx(s.id)+'\')">🗑 O‘chirish</button></div></div></div>';
    }).join(''):'<div class="muted">Avtoshkola yo‘q.</div>';
  }

  window.restoreShowGroups=async id=>{
    let gs=[];
    try{gs=await window.api('/groups?schoolId='+encodeURIComponent(id))||[];}catch{gs=groups().filter(g=>String(g.school_id)===String(id));}
    const s=schools().find(x=>String(x.id)===String(id));
    const host=$('adminSchoolDetail');if(!host)return;
    host.innerHTML='<div class="panel"><div class="modalHead"><div><h3>'+escx(s?.name||'Avtoshkola')+'</h3><div class="muted">Guruhlar va o‘quvchilar</div></div><button class="btn light" onclick="document.getElementById(\'adminSchoolDetail\').innerHTML=\'\'">Yopish</button></div><div class="cards" style="margin-top:14px">'+
      (gs.length?gs.map(g=>'<div class="card"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><div><h3>'+escx(g.name)+'</h3><div class="muted">'+Number(g.student_count||0)+' o‘quvchi</div></div><div class="actions"><button class="btn light" onclick="adminShowStudents(\''+escx(g.id)+'\')">O‘quvchilar</button><button class="btn green" onclick="studentModal(\''+escx(id)+'\',\''+escx(g.id)+'\')">＋ O‘quvchi</button><button class="btn light" onclick="restoreEditGroup(\''+escx(g.id)+'\')">✎</button><button class="btn red" onclick="restoreDeleteGroup(\''+escx(g.id)+'\')">🗑</button><button class="btn light" onclick="bulkStudentModal(\''+escx(id)+'\',\''+escx(g.id)+'\')">📋 Ommaviy</button></div></div><div id="groupStudents_'+escx(g.id)+'"></div></div>').join(''):'<div class="muted">Guruh yo‘q.</div>')+'</div></div>';
  };

  window.restoreEditStudent=id=>{
    const s=students().find(x=>String(x.id)===String(id));if(!s)return;
    const opts=schools().map(x=>'<option value="'+escx(x.id)+'" '+(String(x.id)===String(s.school_id)?'selected':'')+'>'+escx(x.name)+'</option>').join('');
    modal('<h2>O‘quvchini tahrirlash</h2><div class="fg"><label>F.I.Sh.</label><input id="reName" value="'+escx(s.full_name)+'"></div><div class="fg"><label>Telefon</label><input id="rePhone" value="'+escx(s.phone||'')+'"></div><div class="fg"><label>Avtoshkola</label><select id="reSchool">'+opts+'</select></div><div class="fg"><label>Guruh</label><select id="reGroup"></select></div><div class="fg"><label>Avtomobil raqami</label><input id="rePlate" value="'+escx(s.plate||'')+'"></div><div class="fg"><label>Oldingi darslar soni</label><input id="reLessons" type="number" min="0" step="1" value="'+baseLessons(s)+'"></div><div class="actions"><button class="btn green" onclick="restoreSaveStudent(\''+escx(s.id)+'\')">Saqlash</button><button class="btn light" onclick="closeModal()">Bekor</button></div>');
    const fill=async()=>{const gs=await window.api('/groups?schoolId='+encodeURIComponent($('reSchool').value));$('reGroup').innerHTML='<option value="">Tanlang</option>'+gs.map(g=>'<option value="'+escx(g.id)+'" '+(String(g.id)===String(s.group_id)?'selected':'')+'>'+escx(g.name)+'</option>').join('');};
    fill();$('reSchool').onchange=fill;
  };
  window.restoreSaveStudent=async id=>{
    try{
      const notes='ATTENDANCE_BASE='+Math.max(0,Math.floor(Number($('reLessons').value||0)));
      await rapi('/students/'+encodeURIComponent(id),{method:'PUT',body:JSON.stringify({fullName:$('reName').value.trim(),phone:$('rePhone').value.trim(),schoolId:$('reSchool').value,groupId:$('reGroup').value||null,plate:$('rePlate').value.trim(),notes})});
      closeModal();await window.adminLoad();window.adminTab('students');toast('O‘quvchi tahrirlandi.');
    }catch(e){toast(e.message,true);}
  };
  window.restoreDeleteStudent=async id=>{
    if(!confirm('O‘quvchini o‘chirish kerakmi?'))return;
    try{await rapi('/students/'+encodeURIComponent(id),{method:'DELETE'});await window.adminLoad();window.adminTab('students');toast('O‘quvchi o‘chirildi.');}
    catch(e){toast(e.message,true);}
  };

  function renderStudents(){
    const box=$('adminStudents');if(!box)return;
    const q=($('adminStudentQ')?.value||'').trim().toLowerCase();
    const arr=students().filter(s=>[s.full_name,s.phone,s.plate,s.school_name,s.group_name].map(v=>String(v||'').toLowerCase()).join(' ').includes(q));
    box.innerHTML=arr.length?arr.map(s=>'<div class="card" style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"><div><h3>'+escx(s.full_name)+'</h3><div class="muted">📞 '+escx(s.phone||'Telefon yo‘q')+'</div><div class="muted">🏫 '+escx(s.school_name||'')+' • '+escx(s.group_name||'Guruhsiz')+'</div><div class="muted">🚗 '+escx(s.plate||'Avtomobil biriktirilmagan')+'</div></div><div><span class="badge">'+lessons(s)+' dars</span><div class="actions" style="margin-top:8px"><button class="btn light" onclick="restoreEditStudent(\''+escx(s.id)+'\')">✎ Tahrirlash</button><button class="btn red" onclick="restoreDeleteStudent(\''+escx(s.id)+'\')">🗑 O‘chirish</button></div></div></div></div>').join(''):'<div class="muted">O‘quvchi topilmadi.</div>';
  }

  function bulkStudentModal(schoolId='',groupId=''){
    const schoolOpts=schools().map(s=>'<option value="'+escx(s.id)+'" '+(String(s.id)===String(schoolId)?'selected':'')+'>'+escx(s.name)+'</option>').join('');
    modal('<h2>O‘quvchilarni ommaviy qo‘shish</h2><div class="muted">Har qator: F.I.Sh.; telefon; guruh nomi; avtomobil raqami; oldingi darslar soni.</div><div class="fg"><label>Avtoshkola</label><select id="bulkSchool">'+schoolOpts+'</select></div><div class="fg"><label>Ma’lumotlar</label><textarea id="bulkText" rows="10" style="width:100%;padding:11px;border:1px solid #d8e9e1;border-radius:10px" placeholder="Ali Valiyev; +998901112233; A-1; 01 A555AA; 4\nVali Aliyev; +998901234567; B-1; 01 444WWW; 2"></textarea></div><div class="actions"><button class="btn green" onclick="restoreBulkStudents()">＋ Ommaviy qo‘shish</button><button class="btn light" onclick="closeModal()">Bekor</button></div>');
    if(groupId){ setTimeout(async()=>{ const gs=await window.api('/groups?schoolId='+encodeURIComponent($('bulkSchool').value)); const g=gs.find(x=>String(x.id)===String(groupId)); if(g && $('bulkText')) $('bulkText').value=g.name+'; ; '+g.name+'; ; 0'; },50); }
  }
  window.bulkStudentModal=bulkStudentModal;
  window.restoreBulkStudents=async()=>{
    try{
      const schoolId=$('bulkSchool').value;
      const gs=await window.api('/groups?schoolId='+encodeURIComponent(schoolId));
      const rows=String($('bulkText').value||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(line=>{
        const p=line.split(';').map(x=>x.trim());
        const g=gs.find(x=>String(x.id)===String(p[2]||'') || String(x.name).toLowerCase()===String(p[2]||'').toLowerCase());
        return {fullName:p[0],phone:p[1],schoolId,groupId:g?.id||null,plate:p[3]||'',lessons:Number(p[4]||0)};
      });
      if(!rows.length)throw Error('Qatorlar yo‘q');
      const x=await rapi('/students/bulk',{method:'POST',body:JSON.stringify({rows})});
      closeModal();await window.adminLoad();window.adminTab('students');
      toast(x.added+' ta o‘quvchi qo‘shildi'+(x.errors?.length?' • '+x.errors.length+' ta xato':''),!!x.errors?.length);
    }catch(e){toast(e.message,true);}
  };

  function exportStudentsExcel(){
    const rows=students();if(!rows.length){toast('Eksport uchun o‘quvchi yo‘q.',true);return;}
    const eh=v=>escx(v);
    const html='<html><head><meta charset="utf-8"><style>table{border-collapse:collapse;font-family:Arial}td,th{border:1px solid #aaa;padding:7px}th{font-weight:bold}</style></head><body><table><tr><th>F.I.Sh.</th><th>Telefon</th><th>Avtoshkola</th><th>Guruh</th><th>Avtomobil</th><th>Kelgan dars</th><th>Oldingi dars</th></tr>'+rows.map(s=>'<tr><td>'+eh(s.full_name)+'</td><td>'+eh(s.phone||'')+'</td><td>'+eh(s.school_name||'')+'</td><td>'+eh(s.group_name||'')+'</td><td>'+eh(s.plate||'')+'</td><td>'+lessons(s)+'</td><td>'+baseLessons(s)+'</td></tr>').join('')+'</table></body></html>';
    const blob=new Blob(['\ufeff',html],{type:'application/vnd.ms-excel;charset=utf-8'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='avtodrom-oquvchilar-'+new Date().toISOString().slice(0,10)+'.xls';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function wrapAdmin(){
    const old=window.adminTab;
    if(typeof old!=='function' || old.__restoreSafe) return;
    const wrapped=function(t){
      old.apply(this,arguments);
      setTimeout(()=>{
        if(t==='schools') renderSchools();
        if(t==='students'){
          const search=$('adminStudentQ');
          if(search && !$('restoreStudentButtons')){
            const box=document.createElement('div');box.id='restoreStudentButtons';box.className='actions';
            box.innerHTML='<button class="btn green" id="bulkStudentBtn">＋ Ommaviy qo‘shish</button><button class="btn light" id="exportStudentBtn">Excel</button>';
            search.parentElement?.appendChild(box);
            $('bulkStudentBtn').onclick=bulkStudentModal;
            $('exportStudentBtn').onclick=exportStudentsExcel;
          }
          renderStudents();
        }
      },20);
    };
    wrapped.__restoreSafe=true;
    window.adminTab=wrapped;
  }

  function boot(){
    installStartOverride();installWaitingUI();wrapAdmin();setTimeout(wrapAdmin,300);
    setTimeout(()=>{if(token())loadWaiting();},800);
    setInterval(()=>{if(token()){loadWaiting();promote();}},5000);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
