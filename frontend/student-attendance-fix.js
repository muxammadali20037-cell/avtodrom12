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

  /* =========================================================
     AVTODROM: KUNLIK HISOBOT SANASI + O‘QUVCHI TO‘LIQ TARIXI
     Bu qism mavjud interfeysga qo‘shimcha. Eski funksiyalar o‘zgarmaydi.
  ========================================================= */
  const token=()=>localStorage.getItem('avtodrom_token')||'';
  const apiJson=async(url)=>{
    const r=await fetch(url,{headers:{Authorization:'Bearer '+token()}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||'Server xatosi');
    return d;
  };
  const fmtDateTime=x=>x?new Date(x).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent'}):'—';
  const fmtDate=x=>x?new Date(x+'T00:00:00+05:00').toLocaleDateString('uz-UZ'):'';
  const money=n=>Number(n||0).toLocaleString('uz-UZ')+' so‘m';
  const dur=sec=>{sec=Math.max(0,Number(sec||0));const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;return h?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`};
  const localToday=()=>{const d=new Date();const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);const o=Object.fromEntries(p.map(x=>[x.type,x.value]));return `${o.year}-${o.month}-${o.day}`};
  const shiftDays=(date,n)=>{const d=new Date(date+'T12:00:00+05:00');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};

  function injectStyle(){
    if(document.getElementById('avto-history-extra-style'))return;
    const st=document.createElement('style');st.id='avto-history-extra-style';st.textContent=`
      .avx-panel{border:1px solid #d8e9e1;border-radius:15px;background:#fff;padding:16px;margin:0 0 15px;box-shadow:0 8px 25px #0a3b2410}
      .avx-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:end}.avx-tools label{display:grid;gap:5px;font-weight:700;color:#52665e;min-width:180px}.avx-tools input{padding:10px 11px;border:1px solid #d8e9e1;border-radius:10px}.avx-actions{display:flex;gap:7px;flex-wrap:wrap}.avx-btn{border:0;border-radius:10px;padding:10px 13px;font-weight:700;background:#e8f7f0;color:#07854e;cursor:pointer}.avx-btn.primary{background:#07854e;color:#fff}.avx-btn.dark{background:#0b2b20;color:#fff}.avx-summary{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;margin:14px 0}.avx-stat{border:1px solid #d8e9e1;border-radius:12px;padding:12px;background:#f8fcfa}.avx-stat small{display:block;color:#6b7d76;margin-bottom:5px}.avx-stat b{font-size:17px}.avx-table{overflow:auto}.avx-table table{width:100%;border-collapse:collapse;min-width:1100px}.avx-table th,.avx-table td{padding:9px;border-bottom:1px solid #d8e9e1;text-align:left;vertical-align:top}.avx-table th{font-size:11px;color:#6b7d76}.avx-student-search{display:grid;grid-template-columns:minmax(280px,1fr) auto;gap:8px}.avx-results{display:grid;gap:8px;margin-top:10px}.avx-result{border:1px solid #d8e9e1;border-radius:12px;padding:12px;display:flex;justify-content:space-between;gap:10px;align-items:center;background:#fff;cursor:pointer}.avx-result:hover{background:#f4faf7}.avx-profile{margin-top:14px}.avx-profile-head{display:flex;justify-content:space-between;gap:15px;flex-wrap:wrap;border:1px solid #d8e9e1;border-radius:14px;padding:15px;background:#f8fcfa}.avx-cards{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:10px}.avx-card{border:1px solid #d8e9e1;border-radius:11px;padding:10px;background:#fff}.avx-card small{display:block;color:#6b7d76}.avx-card b{display:block;font-size:17px;margin-top:4px}.avx-empty{padding:12px;border-radius:10px;background:#f5faf7;color:#6b7d76}.avx-error{padding:12px;border-radius:10px;background:#fff0ef;color:#b42318}.avx-loading{padding:12px;color:#6b7d76}@media(max-width:900px){.avx-summary,.avx-cards{grid-template-columns:repeat(2,1fr)}}@media(max-width:600px){.avx-tools,.avx-student-search{grid-template-columns:1fr;display:grid}.avx-summary,.avx-cards{grid-template-columns:1fr 1fr}.avx-result{align-items:flex-start;flex-direction:column}}
    `;document.head.appendChild(st);
  }

  async function loadXlsx(){
    if(window.XLSX)return true;
    return await new Promise(resolve=>{
      const s=document.createElement('script');
      s.src='https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
      s.onload=()=>resolve(true);s.onerror=()=>resolve(false);document.head.appendChild(s);
    });
  }

  async function loadRange(from,to){return apiJson(`/api/reports-range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)}

  function renderReportBox(host,data){
    const r=data.summary||{};
    const rows=data.rows||[];
    host.innerHTML=`
      <div class="avx-summary">
        <div class="avx-stat"><small>Avtomobillar</small><b>${r.count||0}</b></div>
        <div class="avx-stat"><small>Umumiy</small><b>${money(r.amount)}</b></div>
        <div class="avx-stat"><small>Naqd</small><b>${money(r.cash)}</b></div>
        <div class="avx-stat"><small>Terminal</small><b>${money(r.terminal)}</b></div>
        <div class="avx-stat"><small>Jami vaqt</small><b>${dur(r.seconds)}</b></div>
      </div>
      <div class="avx-table"><table><thead><tr><th>Raqam</th><th>Kirish</th><th>Chiqish</th><th>Vaqt</th><th>Avtoshkola</th><th>Guruh</th><th>O‘quvchi</th><th>To‘lov</th></tr></thead><tbody>
      ${rows.length?rows.map(x=>`<tr><td><b>${escx(x.plate)}</b><br><span style="color:#6b7d76">${escx(x.model||'')}</span></td><td>${fmtDateTime(x.started_at)}</td><td>${fmtDateTime(x.finished_at)}</td><td>${dur(x.duration_seconds)}</td><td>${escx(x.school_name||'—')}</td><td>${escx(x.group_name||'—')}</td><td>${escx(x.student_name||'—')}${x.student_phone?'<br><span style="color:#6b7d76">'+escx(x.student_phone)+'</span>':''}</td><td>${money(x.amount)}<br><span style="color:#6b7d76">Naqd ${money(x.cash_amount)} · Terminal ${money(x.terminal_amount)}</span></td></tr>`).join(''):`<tr><td colspan="8"><div class="avx-empty">Tanlangan sanalar bo‘yicha yakunlangan hisobot topilmadi.</div></td></tr>`}
      </tbody></table></div>`;
  }

  async function exportXlsx(data){
    const ok=await loadXlsx();
    const rows=data.rows||[];
    const aoa=[
      ['AVTODROM — Kunlik hisobot'],
      ['Davr',data.from,'—',data.to],[],
      ['Raqam','Model','Haydovchi','Kirish','Chiqish','Vaqt','Avtoshkola','Guruh','O‘quvchi','Telefon','Jami','Naqd','Terminal','To‘lov turi'],
      ...rows.map(x=>[x.plate,x.model||'',x.driver_name||'',fmtDateTime(x.started_at),fmtDateTime(x.finished_at),dur(x.duration_seconds),x.school_name||'',x.group_name||'',x.student_name||'',x.student_phone||'',x.amount||0,x.cash_amount||0,x.terminal_amount||0,x.payment_method||''])
    ];
    if(ok){
      const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet(aoa);ws['!cols']=[{wch:16},{wch:15},{wch:20},{wch:21},{wch:21},{wch:12},{wch:20},{wch:12},{wch:24},{wch:18},{wch:14},{wch:14},{wch:14},{wch:14}];XLSX.utils.book_append_sheet(wb,ws,'Hisobot');XLSX.writeFile(wb,`avtodrom-hisobot-${data.from}-${data.to}.xlsx`);return;
    }
    // CDN ishlamasa ham Excel ochadigan .xls fayl beramiz.
    const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const html='<html><head><meta charset="utf-8"></head><body><table border="1">'+aoa.map(row=>'<tr>'+row.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</table></body></html>';
    const blob=new Blob([html],{type:'application/vnd.ms-excel'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`avtodrom-hisobot-${data.from}-${data.to}.xls`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }

  async function mountDaily(){
    const page=document.getElementById('p-daily');if(!page||page.dataset.avxMounted==='1')return;
    page.dataset.avxMounted='1';injectStyle();
    const box=document.createElement('div');box.className='avx-panel';box.innerHTML=`
      <h3 style="margin:0 0 5px">📅 Sana bo‘yicha hisobot</h3>
      <p class="muted" style="margin:0 0 14px">Kecha, 4 kun oldingi, 10 kun oldingi yoki istalgan sanani tanlang. Hisobot Excel formatida ham yuklanadi.</p>
      <div class="avx-tools">
        <label>Dan<input type="date" id="avxFrom"></label>
        <label>Gacha<input type="date" id="avxTo"></label>
        <div class="avx-actions"><button class="avx-btn" data-days="0">Bugun</button><button class="avx-btn" data-days="-1">Kecha</button><button class="avx-btn" data-days="-4">4 kun oldin</button><button class="avx-btn" data-days="-10">10 kun oldin</button><button class="avx-btn primary" id="avxRun">Hisobotni ko‘rish</button><button class="avx-btn dark" id="avxExcel">Excel (.xlsx)</button></div>
      </div>
      <div id="avxReport" class="avx-loading">Sanani tanlang.</div>`;
    page.querySelector('.head')?.after(box);
    const from=box.querySelector('#avxFrom'),to=box.querySelector('#avxTo'),out=box.querySelector('#avxReport');
    const t=localToday();from.value=t;to.value=t;
    let current=null;
    const run=async()=>{if(!from.value||!to.value){out.innerHTML='<div class="avx-error">Ikkala sanani ham tanlang.</div>';return;}out.innerHTML='<div class="avx-loading">Hisobot yuklanmoqda...</div>';try{current=await loadRange(from.value,to.value);renderReportBox(out,current)}catch(e){out.innerHTML='<div class="avx-error">'+escx(e.message)+'</div>'}};
    box.querySelectorAll('[data-days]').forEach(b=>b.onclick=()=>{const d=shiftDays(localToday(),Number(b.dataset.days));from.value=d;to.value=d;run()});
    box.querySelector('#avxRun').onclick=run;
    box.querySelector('#avxExcel').onclick=async()=>{if(!current){await run();if(!current)return;}await exportXlsx(current)};
    run();
  }

  async function fetchStudents(){return apiJson('/api/students')}

  async function mountStudentSearch(){
    const card=document.querySelector('.adminCard');if(!card)return;
    const headings=[...card.querySelectorAll('h1,h2,h3')];
    const h=headings.find(x=>/O‘quvchilar|O\'quvchilar/.test(x.textContent||''));
    if(!h||card.dataset.avxStudentSearch==='1')return;
    card.dataset.avxStudentSearch='1';injectStyle();
    const box=document.createElement('div');box.className='avx-panel';box.innerHTML=`
      <h3 style="margin:0 0 5px">🔎 O‘quvchini qidirish</h3>
      <p class="muted" style="margin:0 0 12px">F.I.Sh. yozing. O‘quvchining telefoni, avtoshkolasi, guruhi, avtomobili, qatnashgan darslari va barcha tashrif vaqtlari chiqadi.</p>
      <div class="avx-student-search"><input id="avxStudentQ" placeholder="Masalan: Muhammadali"><button class="avx-btn primary" id="avxStudentLoad">O‘quvchilarni yuklash</button></div>
      <div id="avxStudentResults" class="avx-results"></div>
      <div id="avxStudentProfile" class="avx-profile"></div>`;
    h.parentElement?.after(box);
    const q=box.querySelector('#avxStudentQ'),results=box.querySelector('#avxStudentResults'),profile=box.querySelector('#avxStudentProfile');
    let all=[];
    const render=()=>{const term=q.value.trim().toLowerCase();const list=all.filter(s=>!term||String(s.full_name||'').toLowerCase().includes(term)||String(s.phone||'').includes(term));results.innerHTML=list.length?list.slice(0,30).map(s=>`<div class="avx-result" data-student-id="${escx(s.id)}"><div><b>${escx(s.full_name)}</b><div class="muted">${escx(s.phone||'Telefon yo‘q')} · ${escx(s.school_name||'')} · ${escx(s.group_name||'')}</div></div><span class="badge">${Number(s.attendance_count||0)} dars</span></div>`).join(''):'<div class="avx-empty">O‘quvchi topilmadi.</div>';};
    const load=async()=>{results.innerHTML='<div class="avx-loading">O‘quvchilar yuklanmoqda...</div>';try{all=await fetchStudents();render()}catch(e){results.innerHTML='<div class="avx-error">'+escx(e.message)+'</div>'}};
    q.oninput=render;box.querySelector('#avxStudentLoad').onclick=load;
    results.addEventListener('click',async e=>{const item=e.target.closest('[data-student-id]');if(!item)return;const id=item.dataset.studentId;profile.innerHTML='<div class="avx-loading">O‘quvchi tarixi yuklanmoqda...</div>';try{const d=await apiJson('/api/student-history?studentId='+encodeURIComponent(id));const s=d.student||{};const rows=d.rows||[];profile.innerHTML=`<div class="avx-profile-head"><div><h3 style="margin:0 0 7px">${escx(s.full_name)}</h3><div>📞 ${escx(s.phone||'Telefon yo‘q')}</div><div>🚗 ${escx(s.plate||'Avtomobil biriktirilmagan')}</div><div>🏫 ${escx(s.school_name||'—')} · ${escx(s.group_name||'—')}</div></div><div class="badge">${Number(d.totalAttendance||0)} ta saqlangan dars</div></div><div class="avx-cards"><div class="avx-card"><small>Saqlangan dars</small><b>${Number(d.totalAttendance||0)}</b></div><div class="avx-card"><small>Avtodrom tashrifi</small><b>${d.completedSessions||0}</b></div><div class="avx-card"><small>Tarix yozuvlari</small><b>${rows.length}</b></div><div class="avx-card"><small>Avtoshkola</small><b>${escx(s.school_name||'—')}</b></div><div class="avx-card"><small>Guruh</small><b>${escx(s.group_name||'—')}</b></div></div><div class="avx-table" style="margin-top:12px"><table><thead><tr><th>#</th><th>Sana va vaqt</th><th>Avtomobil</th><th>Rusum</th><th>Davomiylik</th><th>Holat</th><th>To‘lov</th></tr></thead><tbody>${rows.length?rows.map((x,i)=>`<tr><td>${i+1}</td><td><b>${fmtDateTime(x.started_at)}</b><br>Chiqish: ${fmtDateTime(x.finished_at)}</td><td>${escx(x.plate)}</td><td>${escx(x.model||'—')}</td><td>${dur(x.duration_seconds)}</td><td>${escx(x.status)}</td><td>${money(x.amount)}</td></tr>`).join(''):`<tr><td colspan="7"><div class="avx-empty">Bu o‘quvchi bo‘yicha hali tashrif tarixi yo‘q.</div></td></tr>`}</tbody></table></div>`}catch(err){profile.innerHTML='<div class="avx-error">'+escx(err.message)+'</div>'}});
    load();
  }

  function watch(){
    injectStyle();
    const tryAll=()=>{mountDaily();mountStudentSearch()};
    document.querySelectorAll('.nav[data-p="daily"]').forEach(b=>{if(b.dataset.avxBound)return;b.dataset.avxBound='1';b.addEventListener('click',()=>setTimeout(tryAll,250))});
    tryAll();
  }
  watch();
  new MutationObserver(()=>setTimeout(watch,100)).observe(document.body,{childList:true,subtree:true});
})();
