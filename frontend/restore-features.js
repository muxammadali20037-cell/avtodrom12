/* AVTODROM restore/rescue layer.
   It first repairs and executes the main inline application script if a syntax
   error prevented it from running, then installs the 3-field bulk student UI. */
(async function(){
  'use strict';

  const $=id=>document.getElementById(id);
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const token=()=>localStorage.getItem('avtodrom_token')||'';

  function repairMainScript(){
    if(window.__avtodromMainRestored) return true;
    const scripts=[...document.querySelectorAll('script:not([src])')];
    const main=scripts.find(s=>String(s.textContent||'').includes("const API='/api'"));
    if(!main) return false;
    let code=main.textContent||'';
    code=code.replace("esc(s?.name'')","esc(s?.name||'')");
    code=code.replace("esc(g?.name'')","esc(g?.name||'')");

    const fixedBulk=`function parseBulk(){const lines=($('bulkText').value||'').split(/\\r?\\n/).map(x=>x.trim()).filter(Boolean),rows=[],errors=[];lines.forEach((line,i)=>{let m=line.match(/^(.+?)\\s*(?:,|;|\\t)\\s*(\\d{4}-\\d{2}-\\d{2}|\\d{2}\\.\\d{2}\\.\\d{4})\\s*(?:,|;|\\t)\\s*(\\d+)$/);if(!m)m=line.match(/^(.+?)\\s+(\\d{4}-\\d{2}-\\d{2}|\\d{2}\\.\\d{2}\\.\\d{4})\\s+(\\d+)$/);if(!m){errors.push((i+1)+'-qator: F.I.Sh., tug‘ilgan sana va dars sonini kiriting');return}let birthDate=m[2];if(/^\\d{2}\\.\\d{2}\\.\\d{4}$/.test(birthDate)){const [d,mo,y]=birthDate.split('.');birthDate=y+'-'+mo+'-'+d}const lessons=Number(m[3]);if(!Number.isInteger(lessons)||lessons<0){errors.push((i+1)+'-qator: dars soni noto‘g‘ri');return}rows.push({line:i+1,fullName:m[1].trim(),birthDate,lessons})});return{rows,errors}}\nfunction previewBulk()`;
    const bulkRe=/function parseBulk\(\)\{[\s\S]*?\}\nfunction previewBulk\(\)/;
    if(bulkRe.test(code)) code=code.replace(bulkRe,fixedBulk);

    try{
      const s=document.createElement('script');
      s.type='text/javascript';
      s.textContent=code;
      document.body.appendChild(s);
      window.__avtodromMainRestored=true;
      console.log('AVTODROM main script restored successfully');
      return true;
    }catch(e){
      console.error('AVTODROM main script restore failed:',e);
      return false;
    }
  }

  // The original app script currently has one syntax error. Repair it before
  // installing the feature overrides. A classic script with a syntax error does
  // not prevent later script elements from executing.
  repairMainScript();

  function parseBulk(text){
    const lines=String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean),rows=[],errors=[];
    lines.forEach((line,i)=>{
      let m=line.match(/^(.+?)\s*(?:,|;|\t)\s*(\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})\s*(?:,|;|\t)\s*(\d+)$/);
      if(!m) m=line.match(/^(.+?)\s+(\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})\s+(\d+)$/);
      if(!m){errors.push((i+1)+'-qator: F.I.Sh., tug‘ilgan sana va darslar sonini kiriting.');return;}
      let birthDate=m[2];
      if(/^\d{2}\.\d{2}\.\d{4}$/.test(birthDate)){const [d,mo,y]=birthDate.split('.');birthDate=y+'-'+mo+'-'+d;}
      const lessons=Number(m[3]);
      if(!Number.isInteger(lessons)||lessons<0){errors.push((i+1)+'-qator: darslar soni noto‘g‘ri.');return;}
      rows.push({fullName:m[1].trim(),birthDate,lessons});
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

  setTimeout(installBulkOverride,100);
})();
