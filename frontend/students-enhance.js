const esc=(s='')=>String(s).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#039;'}[c]));
const money=n=>new Intl.NumberFormat('uz-UZ').format(Number(n||0))+' so‘m';
const fmt=iso=>{const d=new Date(iso);return d.toLocaleDateString('uz-UZ')+' '+d.toLocaleTimeString('uz-UZ')};
const dur=sec=>{sec=Math.max(0,Number(sec||0));const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`};

function css(){if(document.getElementById('studentEnhanceCss'))return;const s=document.createElement('style');s.id='studentEnhanceCss';s.textContent=`.student-toolbar{display:flex;gap:10px;align-items:center;margin:14px 0}.student-toolbar input{flex:1;min-width:180px}.student-card-enhanced{cursor:pointer;transition:.16s}.student-card-enhanced:hover{transform:translateY(-1px);box-shadow:0 8px 24px rgba(8,116,67,.10)}.student-modal{position:fixed;inset:0;background:rgba(16,35,26,.34);display:flex;align-items:center;justify-content:center;padding:18px;z-index:100}.student-modal-box{width:min(900px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:18px;border:1px solid #dcebe4;padding:22px;box-shadow:0 24px 70px rgba(8,116,67,.18)}.student-modal-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.student-modal-head h3{margin:0 0 5px}.student-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}.student-summary div{border:1px solid #dcebe4;border-radius:12px;padding:13px;background:#f7fbf9}.student-summary b{display:block;font-size:11px;color:#718078;margin-bottom:5px}.student-summary strong{font-size:17px}.student-history{border:1px solid #dcebe4;border-radius:12px;overflow:hidden}.student-history-row{display:grid;grid-template-columns:1.1fr 1.1fr .8fr .8fr;gap:10px;padding:12px;border-bottom:1px solid #edf3f0;font-size:12px}.student-history-row:last-child{border-bottom:0}.student-history-head{font-weight:800;background:#f7fbf9}.student-empty{padding:20px;text-align:center;color:#718078}@media(max-width:650px){.student-summary{grid-template-columns:1fr 1fr}.student-history-row{grid-template-columns:1fr 1fr}.student-toolbar{flex-direction:column;align-items:stretch}}`;document.head.appendChild(s)}

function closeModal(){document.querySelector('.student-modal')?.remove()}

function studentBirth(student){return student?.birth_date||student?.birthDate||student?.birthday||''}
function studentDate(value){if(!value)return '—';const s=String(value);if(/^\d{4}-\d{2}-\d{2}$/.test(s)){const [y,m,d]=s.split('-');return `${d}.${m}.${y}`}const d=new Date(s);return Number.isNaN(d.getTime())?s:d.toLocaleDateString('uz-UZ')}

function downloadStudentExcel(student){
  const name=String(student?.full_name||'O‘quvchi').trim()||'O‘quvchi';
  const birth=studentDate(studentBirth(student));
  const lessons=Math.max(0,Number(student?.attendance_count||0));
  const rows=[['F.I.Sh.','Tug‘ilgan sana','Qatnashgan darslar soni'],[name,birth,String(lessons)]];
  const html=`<!doctype html><html><head><meta charset="utf-8"></head><body><table border="1"><tr>${rows[0].map(x=>`<th>${esc(x)}</th>`).join('')}</tr><tr>${rows[1].map(x=>`<td>${esc(x)}</td>`).join('')}</tr></table></body></html>`;
  const blob=new Blob([html],{type:'application/vnd.ms-excel;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=`${name.replace(/[^\p{L}\p{N} _-]+/gu,'_')}_tarix.xls`;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  if(typeof window.showToast==='function')window.showToast(`${name} Excel fayli yuklandi`);
}

function installExcel(card,student){
  if(card.dataset.studentExcelFix==='1')return;
  card.dataset.studentExcelFix='1';
  card.addEventListener('click',e=>{
    const btn=e.target?.closest?.('button');
    if(!btn)return;
    const text=(btn.textContent||'').replace(/\s+/g,' ').trim().toLowerCase();
    if(!text.includes('excel')||!text.includes('tarix'))return;
    e.preventDefault();e.stopPropagation();
    if(typeof e.stopImmediatePropagation==='function')e.stopImmediatePropagation();
    downloadStudentExcel(student);
  },true);
}

async function openStudent(student){css();const api=window.Avtodrom;if(!api)return;const modal=document.createElement('div');modal.className='student-modal';modal.innerHTML=`<div class="student-modal-box"><div class="student-modal-head"><div><h3>${esc(student.full_name)}</h3><div>${esc(student.school_name||'')} · ${esc(student.group_name||'Guruhsiz')}</div></div><button class="btn btn-light" id="studentClose">Yopish</button></div><div class="student-summary"><div><b>Qatnashgan dars</b><strong>${student.attendance_count||0}</strong></div><div><b>Avtomobil</b><strong>${esc(student.plate||'—')}</strong></div><div><b>Telefon</b><strong>${esc(student.phone||'—')}</strong></div><div><b>Holat</b><strong>Faol</strong></div></div><div id="studentHistory" class="student-history"><div class="student-empty">Tarix yuklanmoqda...</div></div></div>`;document.body.appendChild(modal);modal.querySelector('#studentClose').onclick=closeModal;modal.addEventListener('click',e=>{if(e.target===modal)closeModal()});const box=modal.querySelector('#studentHistory');if(!student.plate){box.innerHTML='<div class="student-empty">Bu o‘quvchiga avtomobil raqami biriktirilmagan. Qatnashgan darslar soni yuqorida ko‘rsatilgan.</div>';return}try{const r=await api.history(student.plate);const rows=r.rows.filter(x=>x.student_name===student.full_name||x.school_name===student.school_name);box.innerHTML=rows.length?`<div class="student-history-row student-history-head"><span>Sana va vaqt</span><span>Chiqish</span><span>Davomiylik</span><span>Holat</span></div>${rows.map(x=>`<div class="student-history-row"><span>${fmt(x.started_at)}</span><span>${x.finished_at?fmt(x.finished_at):'—'}</span><span>${dur(x.duration_seconds)}</span><span>${Number(x.amount||0)>0?money(x.amount):'BEPUL'}</span></div>`).join('')}`:'<div class="student-empty">Bu o‘quvchi bo‘yicha dars tarixi topilmadi.</div>'}catch(e){box.innerHTML=`<div class="student-empty">Tarixni yuklashda xatolik: ${esc(e.message)}</div>`}}

async function enhance(){const heading=[...document.querySelectorAll('h2')].find(x=>x.textContent.trim()==='O‘quvchilar paneli');if(!heading)return;css();const list=document.querySelector('#studentList');if(!list)return;const school=document.querySelector('#stSchool');const api=window.Avtodrom;if(!api)return;const students=await api.students(school?.value||'');const toolbar=document.getElementById('studentEnhanceToolbar')||document.createElement('div');if(!toolbar.id){toolbar.id='studentEnhanceToolbar';toolbar.className='student-toolbar';toolbar.innerHTML='<input id="studentSearch" placeholder="O‘quvchini ism yoki raqam bilan qidirish...">';list.parentNode.insertBefore(toolbar,list);toolbar.querySelector('#studentSearch').addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();[...list.children].forEach((card,i)=>{const st=students[i];card.style.display=!q||`${st?.full_name||''} ${st?.plate||''}`.toLowerCase().includes(q)?'':'none'})})}const cards=[...list.children];cards.forEach((card,i)=>{const st=students[i];if(!st)return;card.classList.add('student-card-enhanced');card.title='Batafsil ko‘rish';installExcel(card,st);if(card.dataset.studentOpenFix!=='1'){card.dataset.studentOpenFix='1';card.addEventListener('click',e=>{if(e.target?.closest?.('button'))return;openStudent(st)})}})}

const obs=new MutationObserver(()=>enhance().catch(()=>{}));obs.observe(document.body,{childList:true,subtree:true});setTimeout(()=>enhance().catch(()=>{}),250);
