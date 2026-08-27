import { readFile } from 'node:fs/promises';

const frontendFile = new URL('../frontend/index.html', import.meta.url);

const FIX = String.raw`<script id="avtodrom-safe-fixes-v2">
(function(){
  'use strict';
  function byId(id){ return document.getElementById(id); }
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g,function(x){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[x];}); }
  function norm(v){ return String(v ?? '').trim().toLocaleLowerCase('uz').replace(/\s+/g,' '); }
  async function callApi(path,opts){
    if(typeof window.api==='function') return window.api(path,opts);
    const token=localStorage.getItem('avtodrom_token')||'';
    const headers=Object.assign({'Content-Type':'application/json'},token?{Authorization:'Bearer '+token}:{},opts&&opts.headers||{});
    const r=await fetch('/api'+path,{...(opts||{}),headers});
    const t=await r.text();let d={};try{d=t?JSON.parse(t):{}}catch{d={error:t};}
    if(!r.ok)throw new Error(d.error||('HTTP '+r.status));
    return d;
  }
  async function bindStudentRelation(){
    const type=byId('type'),school=byId('school'),group=byId('group'),student=byId('student'),sid=byId('studentId');
    if(!type||!student||student.dataset.safeFix==='1')return;
    student.dataset.safeFix='1';let cache=[],timer=null;
    async function load(){
      const schoolId=school?String(school.value||''):'';const url='/students'+(schoolId?'?schoolId='+encodeURIComponent(schoolId):'');
      const d=await callApi(url);cache=(Array.isArray(d)?d:(d.rows||d.students||[])).slice().sort((a,b)=>norm(a.full_name).localeCompare(norm(b.full_name),'uz',{sensitivity:'base'}));return cache;
    }
    async function apply(){
      const q=norm(student.value);if(!q){if(sid)sid.value='';return;}if(!cache.length)await load();
      const pool=school&&school.value?cache.filter(s=>String(s.school_id||'')===String(school.value)):cache;
      const exact=pool.filter(s=>norm(s.full_name)===q),matches=exact.length?exact:pool.filter(s=>norm(s.full_name).includes(q));
      if(matches.length!==1){if(sid)sid.value='';return;}
      const s=matches[0];student.value=s.full_name||'';if(sid)sid.value=s.id||'';
      if(school&&s.school_id){school.value=String(s.school_id);try{if(typeof window.groupsForSchool==='function')await window.groupsForSchool();}catch{}}
      if(group&&s.group_id){group.value=String(s.group_id);group.disabled=true;}
      if(typeof window.studentInfo==='function')try{window.studentInfo();}catch{}
    }
    type.addEventListener('change',function(){if(type.value==='school'){student.disabled=false;if(group){group.disabled=true;group.innerHTML='<option value="">Guruh o‘quvchidan avtomatik aniqlanadi</option>';}load().catch(()=>{});}});
    if(school)school.addEventListener('change',function(){if(type.value==='school'){cache=[];if(group){group.disabled=true;group.innerHTML='<option value="">Guruh o‘quvchidan avtomatik aniqlanadi</option>';}}});
    student.addEventListener('input',function(){clearTimeout(timer);timer=setTimeout(()=>apply().catch(()=>{}),220);});
    student.addEventListener('change',()=>apply().catch(()=>{}));student.addEventListener('blur',()=>{if(student.value.trim())apply().catch(()=>{});});
  }
  function finishSeconds(v){const st=new Date(v?.started_at||0).getTime();return Number.isFinite(st)&&st>0?Math.max(0,(Date.now()-st)/1000):Number(v?.duration_seconds||0);}
  function finishAmount(v){if(String(v?.customer_type||'').toLowerCase()==='school'||v?.student_id)return 0;const manual=Number(v?.manual_price);if(Number.isFinite(manual)&&manual>0)return manual;const hourly=Number(v?.hourly_rate||0),minimum=Number(v?.minimum_payment||0),sec=finishSeconds(v);return Math.max(minimum,hourly>0?hourly*sec/3600:Number(v?.amount||0));}
  function money(n){return new Intl.NumberFormat('uz-UZ').format(Math.round(Number(n)||0))+' so‘m';}
  function duration(sec){sec=Math.max(0,Math.floor(Number(sec)||0));const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;return [h,m,s].map(x=>String(x).padStart(2,'0')).join(':');}
  function openFinish(id){
    const list=Array.isArray(window.active)?window.active:[],v=list.find(x=>String(x.id)===String(id));if(!v){window.showToast?.('Sessiya topilmadi.',true);return;}
    const key='safe_finish_'+String(id).replace(/[^a-zA-Z0-9_-]/g,'_'),school=String(v.customer_type||'').toLowerCase()==='school'||!!v.student_id;
    const html='<div class="modalHead"><div><h2 style="margin:0">Tugatish</h2><div class="muted">'+esc(v.plate||'')+' · '+esc(v.model||'')+'</div></div><button type="button" class="btn light" onclick="closeModal()">Yopish</button></div>'+
      '<div class="panel" style="margin-top:12px"><div class="kv"><div><span>O‘tgan vaqt</span><b id="safe-finish-time-'+key+'">'+duration(finishSeconds(v))+'</b></div><div><span>Hisoblangan summa</span><b id="safe-finish-price-'+key+'" class="greenText">'+money(finishAmount(v))+'</b></div><div><span>Mijoz</span><b>'+esc(v.student_name||v.driver_name||'Oddiy mijoz')+'</b></div><div><span>Toifa</span><b>'+ (school?'AVTOSHKOLA':'CHASTNIY') +'</b></div></div></div>'+ 
      (school?'':'<div class="fg"><label>To‘lov usuli</label><select id="safe-finish-method-'+key+'"><option value="cash">Naqd</option><option value="terminal">Terminal</option><option value="mixed">Aralash</option></select></div><div id="safe-mixed-'+key+'" class="formGrid hidden"><div class="fg"><label>Naqd</label><input id="safe-cash-'+key+'" type="number" min="0" value="0"></div><div class="fg"><label>Terminal</label><input id="safe-term-'+key+'" type="number" min="0" value="0"></div></div>')+
      '<div class="actions"><button class="btn green" type="button" onclick="safeFinishSession(\\''+esc(String(id))+\\')">Tugatishni tasdiqlash</button><button class="btn light" type="button" onclick="closeModal()">Bekor</button></div><div id="safe-finish-err-'+key+'" class="err"></div>';
    if(typeof window.modal!=='function'){window.showToast?.('Tugatish oynasi mavjud emas.',true);return;}window.modal(html);
    const method=byId('safe-finish-method-'+key);if(method)method.addEventListener('change',()=>{const box=byId('safe-mixed-'+key);if(box)box.classList.toggle('hidden',method.value!=='mixed');});
    const tick=()=>{const te=byId('safe-finish-time-'+key),pe=byId('safe-finish-price-'+key);if(te)te.textContent=duration(finishSeconds(v));if(pe)pe.textContent=money(finishAmount(v));};tick();clearInterval(window.__safeFinishTimer);window.__safeFinishTimer=setInterval(tick,1000);
  }
  async function finishSession(id){
    const list=Array.isArray(window.active)?window.active:[],v=list.find(x=>String(x.id)===String(id));if(!v)return;const school=String(v.customer_type||'').toLowerCase()==='school'||!!v.student_id;const amount=Math.round(finishAmount(v));const key='safe_finish_'+String(id).replace(/[^a-zA-Z0-9_-]/g,'_'),err=byId('safe-finish-err-'+key);let method=school?'cash':(byId('safe-finish-method-'+key)?.value||'cash'),cash=0,terminal=0;
    if(!school&&method==='cash')cash=amount;else if(!school&&method==='terminal')terminal=amount;else if(!school){cash=Number(byId('safe-cash-'+key)?.value||0);terminal=Number(byId('safe-term-'+key)?.value||0);if(Math.abs(cash+terminal-amount)>0.01){if(err)err.textContent='Naqd + Terminal summa hisoblangan narxga teng bo‘lishi kerak.';return;}}
    try{await callApi('/sessions/'+encodeURIComponent(id)+'/finish',{method:'POST',body:JSON.stringify({amount,paymentMethod:method,cashAmount:cash,terminalAmount:terminal})});clearInterval(window.__safeFinishTimer);if(Array.isArray(window.active))window.active=window.active.filter(x=>String(x.id)!==String(id));if(typeof window.closeModal==='function')window.closeModal();if(typeof window.renderFinish==='function')window.renderFinish();if(typeof window.v3LoadActive==='function')await window.v3LoadActive();if(typeof window.renderWaitingQueue==='function')window.renderWaitingQueue();window.showToast?.('Avtomobil muvaffaqiyatli tugatildi.');}catch(e){if(err)err.textContent=e?.message||'Tugatishda xatolik';}
  }
  window.v3OpenFinish=openFinish;window.safeFinishSession=finishSession;
  async function instructorDaily(id){
    const date=(typeof window.localDateISO==='function'?window.localDateISO(0):new Date().toISOString().slice(0,10));
    try{const d=await callApi('/instructors/'+encodeURIComponent(id)+'/daily?date='+encodeURIComponent(date));const rows=Array.isArray(d?.rows)?d.rows:[],inst=d?.instructor||{},name=inst.full_name||inst.name||'Instruktor',totalMin=Math.round(rows.reduce((a,r)=>a+Number(r.duration_seconds||0),0)/60),rowsHtml=rows.map((r,i)=>'<tr><td>'+(i+1)+'</td><td>'+esc(r.plate||'')+'</td><td>'+esc(r.student_name||r.driver_name||'Oddiy mijoz')+'</td><td>'+esc(r.school_name||'')+'</td><td>'+esc(r.group_name||'')+'</td><td>'+esc(r.started_at||'')+'</td><td>'+esc(r.finished_at||'')+'</td><td>'+duration(r.duration_seconds||0)+'</td><td>'+money(r.amount||0)+'</td></tr>').join('');const html='<html><head><meta charset="utf-8"><style>table{border-collapse:collapse}td,th{border:1px solid #999;padding:7px}th{background:#e8f4ee}</style></head><body><h2>'+esc(name)+' — '+esc(date)+'</h2><p>Jami: '+rows.length+' ta dars · '+totalMin+' daqiqa</p><table><tr><th>#</th><th>Avtomobil</th><th>O‘quvchi/Mijoz</th><th>Avtoshkola</th><th>Guruh</th><th>Kirish</th><th>Tugash</th><th>Vaqt</th><th>Summa</th></tr>'+rowsHtml+'</table></body></html>';const blob=new Blob(['\\ufeff'+html],{type:'application/vnd.ms-excel;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(name.replace(/[^\\p{L}\\p{N}]+/gu,'_')||'instruktor')+'-'+date+'.xls';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1200);window.showToast?.('1 kunlik Excel tayyor.');}catch(e){window.showToast?.(e?.message||'Excel yuklanmadi.',true)}
  }
  window.v3InstructorDaily=instructorDaily;
  function bind(){bindStudentRelation().catch(()=>{});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();
<\/script>`;

export default async function handler(req,res){
  if(req.method!=='GET'){res.statusCode=405;res.setHeader('Allow','GET');res.setHeader('Content-Type','application/json; charset=utf-8');return res.end(JSON.stringify({error:'Method ruxsat etilmagan'}));}
  try{const html=await readFile(frontendFile,'utf8');const out=html.includes('id="avtodrom-safe-fixes-v2"')?html:html.replace('</body>',FIX+'</body>');res.statusCode=200;res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');res.setHeader('Pragma','no-cache');res.setHeader('Expires','0');res.setHeader('X-Avtodrom-Frontend','safe-fixes-v2');return res.end(out);}catch(error){console.error('FRONTEND SERVE ERROR:',error?.message||error);res.statusCode=500;res.setHeader('Content-Type','application/json; charset=utf-8');return res.end(JSON.stringify({error:'Frontend yuklanmadi'}));}}
