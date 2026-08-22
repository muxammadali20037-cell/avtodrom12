const esc=(s='')=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const money=n=>new Intl.NumberFormat('uz-UZ').format(Number(n||0))+' so‘m';
const fmt=iso=>{const d=new Date(iso);return d.toLocaleDateString('uz-UZ')+' '+d.toLocaleTimeString('uz-UZ')};
const dur=sec=>{sec=Math.max(0,Number(sec||0));const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`};
function css(){if(document.getElementById('studentEnhanceCss'))return;const s=document.createElement('style');s.id='studentEnhanceCss';s.textContent=`.student-toolbar{display:flex;gap:10px;align-items:center;margin:14px 0}.student-toolbar input{flex:1;min-width:180px}.student-card-enhanced{cursor:pointer;transition:.16s}.student-card-enhanced:hover{transform:translateY(-1px);box-shadow:0 8px 24px rgba(8,116,67,.10)}.student-modal{position:fixed;inset:0;background:rgba(16,35,26,.34);display:flex;align-items:center;justify-content:center;padding:18px;z-index:100}.student-modal-box{width:min(900px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:18px;border:1px solid #dcebe4;padding:22px;box-shadow:0 24px 70px rgba(8,116,67,.18)}.student-modal-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.student-modal-head h3{margin:0 0 5px}.student-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}.student-summary div{border:1px solid #dcebe4;border-radius:12px;padding:13px;background:#f7fbf9}.student-summary b{display:block;font-size:11px;color:#718078;margin-bottom:5px}.student-summary strong{font-size:17px}.student-history{border:1px solid #dcebe4;border-radius:12px;overflow:hidden}.student-history-row{display:grid;grid-template-columns:1.1fr 1.1fr .8fr .8fr;gap:10px;padding:12px;border-bottom:1px solid #edf3f0;font-size:12px}.student-history-row:last-child{border-bottom:0}.student-history-head{font-weight:800;background:#f7fbf9}.student-empty{padding:20px;text-align:center;color:#718078}@media(max-width:650px){.student-summary{grid-template-columns:1fr 1fr}.student-history-row{grid-template-columns:1fr 1fr}.student-toolbar{flex-direction:column;align-items:stretch}}`;document.head.appendChild(s)}
function closeModal(){document.querySelector('.student-modal')?.remove()}
async function openStudent(student){css();const api=window.Avtodrom;if(!api)return;const modal=document.createElement('div');modal.className='student-modal';modal.innerHTML=`<div class="student-modal-box"><div class="student-modal-head"><div><h3>${esc(student.full_name)}</h3><div>${esc(student.school_name||'')} · ${esc(student.group_name||'Guruhsiz')}</div></div><button class="btn btn-light" id="studentClose">Yopish</button></div><div class="student-summary"><div><b>Qatnashgan dars</b><strong>${student.attendance_count||0}</strong></div><div><b>Avtomobil</b><strong>${esc(student.plate||'—')}</strong></div><div><b>Telefon</b><strong>${esc(student.phone||'—')}</strong></div><div><b>Holat</b><strong>Faol</strong></div></div><div id="studentHistory" class="student-history"><div class="student-empty">Tarix yuklanmoqda...</div></div></div>`;document.body.appendChild(modal);modal.querySelector('#studentClose').onclick=closeModal;modal.addEventListener('click',e=>{if(e.target===modal)closeModal()});const box=modal.querySelector('#studentHistory');if(!student.plate){box.innerHTML='<div class="student-empty">Avtomobil raqami o‘quvchiga biriktirilmagan. Quyidagi tarix sessiyalardan avtomatik topiladi.</div>'}try{const r=student.plate?await api.history(student.plate):{rows:[]};const rows=(r.rows||[]).filter(x=>sameStudent(x,student));renderStudentHistory(box,rows)}catch(e){box.innerHTML=`<div class="student-empty">Tarixni yuklashda xatolik: ${esc(e.message)}</div>`}}
function sameStudent(x,student){const idOk=x.student_id&&student.id&&String(x.student_id)===String(student.id);const nameOk=x.student_name&&String(x.student_name).trim().toLowerCase()===String(student.full_name||'').trim().toLowerCase();return idOk||nameOk}
function renderStudentHistory(box,rows){const sorted=[...rows].sort((a,b)=>new Date(b.started_at||0)-new Date(a.started_at||0));box.innerHTML=sorted.length?`<div class="student-history-row student-history-head"><span>Sana va vaqt</span><span>Chiqish</span><span>Avtomobil</span><span>Davomiylik</span></div>${sorted.map(x=>`<div class="student-history-row"><span>${fmt(x.started_at)}</span><span>${x.finished_at?fmt(x.finished_at):'—'}</span><span>${esc(x.plate||'—')}</span><span>${dur(x.duration_seconds)}${Number(x.amount||0)>0?' · '+money(x.amount):' · BEPUL'}</span></div>`).join('')}`:'<div class="student-empty">Bu o‘quvchi bo‘yicha dars tarixi topilmadi.</div>'}
async function enhance(){const heading=[...document.querySelectorAll('h2')].find(x=>x.textContent.trim()==='O‘quvchilar paneli');if(!heading)return;css();const list=document.querySelector('#studentList');if(!list||list.dataset.enhanced==='1')return;list.dataset.enhanced='1';const school=document.querySelector('#stSchool');const api=window.Avtodrom;if(!api)return;const students=await api.students(school?.value||'');const toolbar=document.createElement('div');toolbar.className='student-toolbar';toolbar.innerHTML='<input id="studentSearch" placeholder="O‘quvchini ism yoki raqam bilan qidirish...">';list.parentNode.insertBefore(toolbar,list);const cards=[...list.children];cards.forEach((card,i)=>{const st=students[i];if(!st)return;card.classList.add('student-card-enhanced');card.title='Batafsil ko‘rish';card.addEventListener('click',()=>openStudent(st))});toolbar.querySelector('#studentSearch').addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();cards.forEach((card,i)=>{const st=students[i];card.style.display=!q||`${st?.full_name||''} ${st?.plate||''}`.toLowerCase().includes(q)?'':'none'})})}
const obs=new MutationObserver(()=>{enhance().catch(()=>{})});obs.observe(document.body,{childList:true,subtree:true});setTimeout(()=>enhance().catch(()=>{}),250);

/*
 * Student history fix:
 * The old enhancement depended on the student's own saved plate number.
 * A lesson can use a vehicle plate without that plate being stored on the
 * student record, so the history must be loaded by student_id/name instead.
 * We keep the original UI and only add a fallback that reads completed
 * daily reports backwards until all recorded attendance sessions are found.
 */
async function fetchStudentHistory(student){
  const api=window.Avtodrom;if(!api)return [];
  let rows=[];
  if(student.plate){
    try{const r=await api.history(student.plate);rows=Array.isArray(r?.rows)?r.rows:[]}catch{}
    rows=rows.filter(x=>sameStudent(x,student));
  }
  if(rows.length>=Number(student.attendance_count||0))return rows;

  const target=Math.max(0,Number(student.attendance_count||0));
  const created=new Date(student.created_at||0);
  const minDate=Number.isFinite(created.getTime())?new Date(created.getFullYear(),created.getMonth(),created.getDate()):new Date(Date.now()-365*86400000);
  const cursor=new Date();
  const seen=new Set(rows.map(x=>x.id||`${x.started_at}|${x.plate}`));
  let safety=0;
  while(cursor>=minDate && safety<730 && (target===0 || rows.length<target)){
    const date=`${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-${String(cursor.getDate()).padStart(2,'0')}`;
    try{
      const r=await api.report(date);
      for(const x of (r?.rows||[])){
        if(!sameStudent(x,student))continue;
        const key=x.id||`${x.started_at}|${x.plate}`;
        if(!seen.has(key)){seen.add(key);rows.push(x)}
      }
    }catch{}
    cursor.setDate(cursor.getDate()-1);safety++;
  }
  return rows.sort((a,b)=>new Date(b.started_at||0)-new Date(a.started_at||0));
}

/* Replace only the broken detail loader from index.html. Everything else stays unchanged. */
window.showStudentDetail=async function(id){
  const all=await window.Avtodrom.students('');
  const s=(all||[]).find(x=>String(x.id)===String(id));
  const box=document.getElementById('adminStudentDetail');
  if(!s||!box)return;
  box.innerHTML='<div class="panel studentDetailPanel"><div class="muted">O‘quvchi tarixi yuklanmoqda...</div></div>';
  try{
    const rows=await fetchStudentHistory(s);
    const n=Number(s.attendance_count||0);
    box.innerHTML='<div class="panel studentDetailPanel">'+
      '<div class="studentHistoryTitle"><div><h3 style="margin:0">'+esc(s.full_name)+'</h3><div class="studentHistoryMeta">'+esc(s.school_name||'')+' • '+esc(s.group_name||'Guruhsiz')+' • '+esc(s.phone||'Telefon kiritilmagan')+'</div></div><button class="btn light" type="button" onclick="document.getElementById(\'adminStudentDetail\').innerHTML=\'\'">Yopish</button></div>'+
      '<div class="kv" style="margin:14px 0"><div><b>'+n+'</b><span>Jami qatnashuv</span></div><div><b>'+esc(s.plate||'—')+'</b><span>Biriktirilgan avtomobil</span></div><div><b>'+rows.length+'</b><span>Tarixdagi dars</span></div><div><b>'+(n<6?'1–5 normal':n<12?'6–11 qizil':'12+ yangi bosqich')+'</b><span>Holat</span></div></div>'+\
      '<div class="studentHistoryTitle"><h3 style="margin:0">Dars qatnashuv tarixi</h3><span class="studentHistoryMeta">Sana • vaqt • avtomobil • davomiylik</span></div>'+\
      (rows.length?`<div class="tableWrap"><table class="table"><thead><tr><th>#</th><th>Sana</th><th>Kirish</th><th>Chiqish</th><th>Avtomobil</th><th>Davomiylik</th><th>Avtoshkola</th><th>Guruh</th></tr></thead><tbody>${rows.map((x,i)=>`<tr><td>${i+1}</td><td>${new Date(x.started_at).toLocaleDateString('uz-UZ')}</td><td>${new Date(x.started_at).toLocaleTimeString('uz-UZ')}</td><td>${x.finished_at?new Date(x.finished_at).toLocaleTimeString('uz-UZ'):'—'}</td><td><b>${esc(x.plate||'—')}</b></td><td>${dur(x.duration_seconds)}</td><td>${esc(x.school_name||s.school_name||'—')}</td><td>${esc(x.group_name||s.group_name||'—')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="muted" style="padding:15px 0">Bu o‘quvchi bo‘yicha tarixiy sessiyalar topilmadi. Yangi dars tugatilgach sana, vaqt va avtomobil shu yerda avtomatik ko‘rinadi.</div>')+
      '</div>';
  }catch(e){box.innerHTML='<div class="panel studentDetailPanel err">Tarixni yuklashda xatolik: '+esc(e.message)+'</div>'}
};