/* Safe compatibility loader: keep the existing restore features, then replace only bulk student import UI. */
(async function(){
  'use strict';
  const legacyUrl='https://raw.githubusercontent.com/muxammadali20037-cell/avtodrom12/79921d94a2f5f05ef1be75b77c6d6bf0dd4d4f88/frontend/restore-features.js';
  try{
    const r=await fetch(legacyUrl,{cache:'no-store'});
    if(!r.ok) throw new Error('Legacy restore script yuklanmadi');
    const code=await r.text();
    (0,eval)(code);
  }catch(e){console.error('RESTORE FEATURES LOAD:',e);}

  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const token=()=>localStorage.getItem('avtodrom_token')||'';

  function parseBulk(text){
    const lines=String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean),rows=[],errors=[];
    lines.forEach((line,i)=>{
      const p=line.split(/[,;\t]/).map(x=>x.trim());
      if(p.length!==3){errors.push((i+1)+'-qator: F.I.Sh., tug‘ilgan sana va darslar soni kerak.');return;}
      const fullName=p[0],birthDate=p[1],lessons=Number(p[2]);
      if(!fullName){errors.push((i+1)+'-qator: F.I.Sh. bo‘sh.');return;}
      if(!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)){errors.push((i+1)+'-qator: sana YYYY-MM-DD formatida bo‘lsin.');return;}
      const d=new Date(birthDate+'T00:00:00');
      if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==birthDate){errors.push((i+1)+'-qator: tug‘ilgan sana noto‘g‘ri.');return;}
      if(!Number.isInteger(lessons)||lessons<0){errors.push((i+1)+'-qator: darslar soni noto‘g‘ri.');return;}
      rows.push({fullName,birthDate,lessons});
    });
    return {rows,errors};
  }

  async function saveBulk(schoolId,groupId){
    const out=$('bulkOut'),btn=$('bulkSaveBtn'),p=parseBulk($('bulkText')?.value||'');
    if(p.errors.length){out.innerHTML='<div class="studentDetail"><div class="err">'+p.errors.map(esc).join('<br>')+'</div></div>';return;}
    if(!p.rows.length){out.innerHTML='<div class="err">Qatorlar yo‘q.</div>';return;}
    btn.disabled=true;btn.textContent='Saqlanmoqda...';
    try{
      const r=await fetch('/api/student-bulk',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token()},body:JSON.stringify({schoolId,groupId,rows:p.rows})});
      const x=await r.json();
      if(!r.ok) throw Error(x.error||'Ommaviy qo‘shishda xatolik');
      if(typeof window.closeModal==='function') window.closeModal();
      if(typeof window.adminLoad==='function') await window.adminLoad();
      if(typeof window.adminTab==='function') window.adminTab('students');
      if(typeof window.toast==='function') window.toast((x.added||0)+' ta o‘quvchi qo‘shildi'+(x.errors?.length?' • '+x.errors.length+' ta xato':''),!!x.errors?.length);
    }catch(e){out.innerHTML='<div class="err">'+esc(e.message||e)+'</div>';btn.disabled=false;btn.textContent='✓ Hammasini qo‘shish';}
  }

  function installBulkOverride(){
    if(typeof window.modal!=='function') return;
    window.bulkStudentModal=function(schoolId,groupId){
      const gs=Array.isArray(window.groups)?window.groups:[];
      const g=gs.find(x=>String(x.id)===String(groupId));
      window.modal('<h2>📋 O‘quvchilarni ommaviy qo‘shish</h2>'+
        '<div class="muted">Guruh: <b>'+esc(g?.name||'Tanlanmagan')+'</b></div>'+
        '<div class="studentDetail"><b>Faqat 3 ta ma’lumot:</b> F.I.Sh., tug‘ilgan sana, darslar soni.<br>'+
        '<span class="mini">Har qator: Aliyev Muhammad, 1992-01-14, 4</span><br>'+
        '<span class="mini">Telefon, avtomobil, guruh yoki boshqa ma’lumot kerak emas.</span></div>'+
        '<div class="fg"><label>O‘quvchilar ro‘yxati</label><textarea id="bulkText" rows="12" placeholder="Aliyev Muhammad, 1992-01-14, 4&#10;Karimov Aziz, 1995-06-22, 0"></textarea></div>'+
        '<div class="actions"><button type="button" class="btn light" id="bulkPreviewBtn">🔎 Tekshirish</button><button type="button" class="btn green" id="bulkSaveBtn">✓ Hammasini qo‘shish</button><button type="button" class="btn light" onclick="closeModal()">Bekor</button></div><div id="bulkOut"></div>');
      $('bulkPreviewBtn').onclick=()=>{const p=parseBulk($('bulkText').value);$('bulkOut').innerHTML='<div class="studentDetail"><b>'+p.rows.length+' ta tayyor</b>'+(p.errors.length?'<div class="err">'+p.errors.map(esc).join('<br>')+'</div>':'<div class="ok">Ma’lumotlar to‘g‘ri.</div>')+'</div>';};
      $('bulkSaveBtn').onclick=()=>saveBulk(String(schoolId),String(groupId||''));
    };
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(installBulkOverride,50));
  else setTimeout(installBulkOverride,50);
})();
