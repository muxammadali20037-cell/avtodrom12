import { readFile } from 'node:fs/promises';

const frontendFile = new URL('../frontend/index.html', import.meta.url);

const PATCH = `<script id="avtodrom-static-safe-v1">
(function(){
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const token = () => localStorage.getItem('avtodrom_token') || '';
  async function apiCall(path, options){
    const opts = options || {};
    const headers = Object.assign({'Content-Type':'application/json'}, token() ? {Authorization:'Bearer '+token()} : {}, opts.headers || {});
    const r = await fetch('/api'+path, Object.assign({}, opts, {headers}));
    const text = await r.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = {error:text}; }
    if(!r.ok) throw new Error(data.error || ('HTTP '+r.status));
    return data;
  }
  function duration(sec){
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
    return [h,m,s].map(x=>String(x).padStart(2,'0')).join(':');
  }
  function money(n){ return new Intl.NumberFormat('uz-UZ').format(Math.round(Number(n)||0))+' so‘m'; }
  function elapsed(v){
    const t = new Date(v && v.started_at || 0).getTime();
    if(Number.isFinite(t) && t > 0) return Math.max(0,(Date.now()-t)/1000);
    return Number(v && v.duration_seconds || 0);
  }
  function isSchool(v){ return String(v && v.customer_type || '').toLowerCase()==='school' || !!(v && v.student_id); }
  function amount(v){
    if(isSchool(v)) return 0;
    const manual = Number(v && v.manual_price);
    if(Number.isFinite(manual) && manual > 0) return manual;
    const hourly = Number(v && v.hourly_rate || 0);
    const minimum = Number(v && v.minimum_payment || 0);
    return Math.max(minimum, hourly > 0 ? hourly * elapsed(v) / 3600 : Number(v && v.amount || 0));
  }
  async function activeById(id){
    const local = Array.isArray(window.active) ? window.active.find(x=>String(x.id)===String(id)) : null;
    if(local) return local;
    const data = await apiCall('/sessions/active');
    const list = Array.isArray(data) ? data : (data.rows || []);
    return list.find(x=>String(x.id)===String(id)) || null;
  }
  function closeSafeModal(){
    const el = $('avtodromSafeFinishModal');
    if(el) el.remove();
    if(window.__avtodromSafeFinishTimer) clearInterval(window.__avtodromSafeFinishTimer);
  }
  window.v3OpenFinish = async function(id){
    try{
      const v = await activeById(id);
      if(!v) throw new Error('Faol sessiya topilmadi');
      closeSafeModal();
      const school = isSchool(v);
      const root = document.createElement('div');
      root.id = 'avtodromSafeFinishModal';
      root.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(7,25,18,.55);display:grid;place-items:center;padding:18px';
      const box = document.createElement('div');
      box.style.cssText='width:min(620px,100%);max-height:92vh;overflow:auto;background:#fff;border-radius:18px;padding:20px;font-family:Arial,sans-serif';
      const idSafe = esc(String(id));
      box.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><div><h2 style="margin:0 0 5px">Tugatish</h2><div style="color:#6b7d76">'+esc(v.plate||'')+' · '+esc(v.model||'')+'</div></div><button id="sfClose" style="border:0;border-radius:10px;padding:10px 14px;background:#e8f7f0;color:#07854e;font-weight:700">Yopish</button></div>'+
      '<div style="margin-top:14px;display:grid;grid-template-columns:repeat(2,1fr);gap:9px">'+
      '<div style="background:#f5faf7;border-radius:10px;padding:12px"><small style="color:#6b7d76">O‘tgan vaqt</small><b id="sfTime" style="display:block;font-size:19px">'+duration(elapsed(v))+'</b></div>'+ 
      '<div style="background:#f5faf7;border-radius:10px;padding:12px"><small style="color:#6b7d76">Summa</small><b id="sfAmount" style="display:block;font-size:19px;color:#07854e">'+money(amount(v))+'</b></div>'+ 
      '<div style="background:#f5faf7;border-radius:10px;padding:12px"><small style="color:#6b7d76">Mijoz</small><b style="display:block">'+esc(v.student_name||v.driver_name||'Oddiy mijoz')+'</b></div>'+ 
      '<div style="background:#f5faf7;border-radius:10px;padding:12px"><small style="color:#6b7d76">Toifa</small><b style="display:block">'+(school?'AVTOSHKOLA':'CHASTNIY')+'</b></div></div>'+ 
      (school ? '<div style="margin-top:14px;padding:12px;border-radius:10px;background:#e8f7f0;color:#07854e;font-weight:700">Avtoshkola o‘quvchisi — BEPUL</div>' :
      '<div style="margin-top:14px"><label style="font-weight:700;display:block;margin-bottom:6px">Yakuniy narx</label><input id="sfFinalAmount" type="number" min="0" step="100" value="'+Math.round(amount(v))+'" style="width:100%;padding:11px 12px;border:1px solid #d8e9e1;border-radius:10px;box-sizing:border-box"><label style="font-weight:700;display:block;margin:12px 0 6px">To‘lov turi</label><select id="sfMethod" style="width:100%;padding:11px 12px;border:1px solid #d8e9e1;border-radius:10px"><option value="cash">Naqd</option><option value="terminal">Terminal</option><option value="mixed">Aralash</option></select><div id="sfMixed" style="display:none;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px"><div><label style="font-weight:700;display:block;margin-bottom:6px">Naqd</label><input id="sfCash" type="number" min="0" value="0" style="width:100%;padding:11px 12px;border:1px solid #d8e9e1;border-radius:10px;box-sizing:border-box"></div><div><label style="font-weight:700;display:block;margin-bottom:6px">Terminal</label><input id="sfTerminal" type="number" min="0" value="0" style="width:100%;padding:11px 12px;border:1px solid #d8e9e1;border-radius:10px;box-sizing:border-box"></div></div></div>')+
      '<div style="display:flex;gap:8px;margin-top:16px"><button id="sfConfirm" style="border:0;border-radius:10px;padding:11px 15px;background:#07854e;color:#fff;font-weight:700">Tugatishni tasdiqlash</button><button id="sfCancel" style="border:0;border-radius:10px;padding:11px 15px;background:#e8f7f0;color:#07854e;font-weight:700">Bekor</button></div><div id="sfError" style="color:#b42318;margin-top:9px"></div>';
      root.appendChild(box); document.body.appendChild(root);
      $('sfClose').onclick=closeSafeModal; $('sfCancel').onclick=closeSafeModal;
      if(!school){
        $('sfMethod').onchange=function(){ $('sfMixed').style.display=this.value==='mixed'?'grid':'none'; };
        $('sfFinalAmount').oninput=function(){const m=$('sfMethod').value;if(m==='cash')$('sfCash').value=this.value;if(m==='terminal')$('sfTerminal').value=this.value;};
        $('sfMethod').dispatchEvent(new Event('change'));
      }
      $('sfConfirm').onclick=async function(){
        const err=$('sfError'); err.textContent=''; this.disabled=true;
        try{
          let finalAmount = school ? 0 : Math.max(0, Number($('sfFinalAmount').value||0));
          let method = school ? 'cash' : $('sfMethod').value;
          let cash=0, terminal=0;
          if(school){cash=0;terminal=0;}
          else if(method==='cash'){cash=finalAmount;terminal=0;}
          else if(method==='terminal'){cash=0;terminal=finalAmount;}
          else {cash=Number($('sfCash').value||0);terminal=Number($('sfTerminal').value||0);if(Math.abs(cash+terminal-finalAmount)>0.01) throw new Error('Naqd + terminal summasi yakuniy narxga teng bo‘lishi kerak');}
          await apiCall('/sessions/'+encodeURIComponent(String(id))+'/finish',{method:'POST',body:JSON.stringify({amount:finalAmount,paymentMethod:method,cashAmount:cash,terminalAmount:terminal})});
          closeSafeModal();
          window.location.reload();
        }catch(e){err.textContent=e && e.message ? e.message : 'Tugatishda xatolik';this.disabled=false;}
      };
      const tick=()=>{if($('sfTime'))$('sfTime').textContent=duration(elapsed(v));}; tick(); window.__avtodromSafeFinishTimer=setInterval(tick,1000);
    }catch(e){ if(window.showToast) window.showToast(e.message||'Tugatish oynasi ochilmadi',true); }
  };
  window.v3InstructorDaily = async function(id){
    try{
      const date = typeof window.localDateISO==='function' ? window.localDateISO(0) : new Date().toISOString().slice(0,10);
      const data = await apiCall('/instructors/'+encodeURIComponent(String(id))+'/daily?date='+encodeURIComponent(date));
      const rows = Array.isArray(data && data.rows) ? data.rows : [];
      const name = (data && data.instructor && data.instructor.full_name) || 'Instruktor';
      const escCell = v => String(v ?? '').replace(/"/g,'""');
      const lines = [];
      lines.push(['#','Avtomobil','Rusumi','O‘quvchi/Mijoz','Avtoshkola','Guruh','Kirish','Tugash','Davomiylik','Summa','To‘lov turi'].map(x=>'"'+escCell(x)+'"').join(';'));
      rows.forEach((r,i)=>{
        lines.push([i+1,r.plate||'',r.model||'',r.student_name||r.driver_name||'Oddiy mijoz',r.school_name||'',r.group_name||'',r.started_at||'',r.finished_at||'',duration(r.duration_seconds),r.amount||0,r.payment_method||''].map(x=>'"'+escCell(x)+'"').join(';'));
      });
      const blob = new Blob(['\\ufeff'+lines.join('\\r\\n')],{type:'text/csv;charset=utf-8'});
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=(name.replace(/[^\\p{L}\\p{N}]+/gu,'_')||'instruktor')+'-'+date+'.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1500);
      if(window.showToast) window.showToast('1 kunlik Excel/CSV tayyor.');
    }catch(e){ if(window.showToast) window.showToast(e.message||'Excel yuklanmadi.',true); }
  };
})();
<\/script>`;

export default async function handler(req,res){
  if(req.method!=='GET'){
    res.statusCode=405;
    res.setHeader('Allow','GET');
    return res.end(JSON.stringify({error:'Method ruxsat etilmagan'}));
  }
  try{
    const html = await readFile(frontendFile,'utf8');
    const out = html.includes('id="avtodrom-static-safe-v1"') ? html : html.replace('</body>', PATCH+'</body>');
    res.statusCode=200;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma','no-cache');
    res.setHeader('Expires','0');
    res.setHeader('X-Avtodrom-Frontend','static-safe-v1');
    return res.end(out);
  }catch(e){
    res.statusCode=500;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    return res.end(JSON.stringify({error:'Frontend yuklanmadi'}));
  }
}
