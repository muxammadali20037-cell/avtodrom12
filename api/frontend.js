import { readFile } from 'node:fs/promises';

const frontendFile = new URL('../frontend/index.html', import.meta.url);

const FIX = String.raw`<script id="avtodrom-relation-fix-v1">
(function(){
  'use strict';

  function byId(id){ return document.getElementById(id); }
  function norm(v){ return String(v ?? '').trim().toLocaleLowerCase('uz').replace(/\s+/g,' '); }
  function esc(v){ return String(v ?? '').replace(/[&<>\"']/g, function(x){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[x]); }); }
  function sorted(list){
    return (Array.isArray(list) ? list.slice() : []).sort(function(a,b){
      return norm(a.full_name).localeCompare(norm(b.full_name),'uz',{sensitivity:'base'});
    });
  }

  async function loadSchoolOptions(){
    var school=byId('school');
    if(!school) return [];
    try{
      var list = Array.isArray(window.__avtodromSchools) ? window.__avtodromSchools : await api('/schools');
      window.__avtodromSchools = list || [];
      if(!school.options.length || school.options.length===1){
        school.innerHTML='<option value="">Tanlang</option>' + sorted(window.__avtodromSchools).map(function(s){
          return '<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>';
        }).join('');
      }
      return window.__avtodromSchools;
    }catch(e){ return []; }
  }

  async function loadStudentPool(schoolId){
    try{
      var url='/students'+(schoolId ? '?schoolId='+encodeURIComponent(schoolId) : '');
      var list=await api(url);
      return sorted(Array.isArray(list)?list:(list&&Array.isArray(list.rows)?list.rows:[]));
    }catch(e){ return []; }
  }

  function showStudent(s){
    var student=byId('student'), sid=byId('studentId'), school=byId('school'), group=byId('group'), box=byId('studentBox');
    if(!s || !sid || !student) return;
    student.value=String(s.full_name||'');
    sid.value=String(s.id||'');

    if(school && s.school_id){
      loadSchoolOptions().then(function(){ school.value=String(s.school_id); });
    }

    if(group && s.group_id){
      group.innerHTML='<option value="">Guruh yuklanmoqda...</option>';
      api('/groups?schoolId='+encodeURIComponent(s.school_id)).then(function(gs){
        var arr=sorted(Array.isArray(gs)?gs:(gs&&Array.isArray(gs.rows)?gs.rows:[]));
        group.innerHTML='<option value="">Guruh</option>'+arr.map(function(g){
          return '<option value="'+esc(g.id)+'">'+esc(g.name)+' ('+Number(g.student_count||0)+')</option>';
        }).join('');
        group.value=String(s.group_id);
        group.disabled=true;
      }).catch(function(){
        group.innerHTML='<option value="">'+esc(s.group_name||'Guruh')+'</option>';
        group.disabled=true;
      });
    }else if(group){
      group.innerHTML='<option value="">Guruhsiz</option>';
      group.disabled=true;
    }

    if(box){
      var n=Number(s.attendance_count||0);
      box.innerHTML='<div class="attendance"><div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><div><b style="font-size:19px">'+esc(s.full_name||'')+'</b><div class="muted">🏫 '+esc(s.school_name||'—')+' • 👥 '+esc(s.group_name||'Guruhsiz')+'</div></div><span class="badge '+(n>=12?'blue':n>=6?'red':'')+'">'+n+' marta qatnashgan</span></div><div class="attGrid"><div class="att"><b>'+n+'</b><span class="muted">Kelgan dars</span></div><div class="att"><b>'+esc(s.plate||'—')+'</b><span class="muted">Avtomobil</span></div><div class="att"><b>Avtomatik</b><span class="muted">Avtoshkola</span></div><div class="att"><b>Avtomatik</b><span class="muted">Guruh</span></div></div></div>';
    }
  }

  async function resolveStudent(value){
    var type=byId('type'), student=byId('student'), sid=byId('studentId'), school=byId('school');
    if(!type || type.value!=='school' || !student) return;
    var q=norm(value);
    if(!q){ if(sid) sid.value=''; return; }

    var schoolId=school ? String(school.value||'') : '';
    var pool=await loadStudentPool(schoolId);
    var exact=pool.filter(function(s){ return norm(s.full_name)===q; });
    var matches=exact.length ? exact : pool.filter(function(s){ return norm(s.full_name).indexOf(q)!==-1; });

    if(matches.length!==1){
      if(sid) sid.value='';
      var box=byId('studentBox');
      if(box && matches.length>1) box.innerHTML='<div class="muted">Bir nechta o‘quvchi topildi. To‘liq ism-familiyani tanlang.</div>';
      return;
    }
    showStudent(matches[0]);
  }

  function bind(){
    if(document.documentElement.dataset.avtodromRelationFix==='1') return;
    document.documentElement.dataset.avtodromRelationFix='1';
    var type=byId('type'), school=byId('school'), student=byId('student'), group=byId('group');
    if(!type || !student) return;

    type.addEventListener('change',function(){
      if(type.value==='school'){
        if(student) student.disabled=false;
        if(group){ group.disabled=true; group.innerHTML='<option value="">Guruh o‘quvchidan avtomatik aniqlanadi</option>'; }
        loadSchoolOptions().catch(function(){});
      }
    });

    if(school) school.addEventListener('change',function(){
      if(type.value!=='school') return;
      if(group){ group.disabled=true; group.innerHTML='<option value="">Guruh o‘quvchidan avtomatik aniqlanadi</option>'; }
      if(byId('studentId')) byId('studentId').value='';
      loadStudentPool(String(school.value||'')).then(function(list){
        window.__avtodromStudentPool=list;
      });
    });

    var timer=null;
    var run=function(){
      clearTimeout(timer);
      var value=student.value;
      if(!value.trim() || type.value!=='school') return;
      timer=setTimeout(function(){ resolveStudent(value).catch(function(){}); },220);
    };
    student.addEventListener('input',run);
    student.addEventListener('change',function(){resolveStudent(student.value).catch(function(){})});
    student.addEventListener('blur',function(){if(student.value.trim())resolveStudent(student.value).catch(function(){})});

    // Ensure school mode is ready after the original application boots.
    setTimeout(function(){ if(type.value==='school'){ student.disabled=false; loadSchoolOptions().catch(function(){}); } },250);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind,{once:true});
  else bind();
})();
<\/script>`;

export default async function handler(req,res){
  if(req.method!=='GET'){
    res.statusCode=405;
    res.setHeader('Allow','GET');
    res.setHeader('Content-Type','application/json; charset=utf-8');
    return res.end(JSON.stringify({error:'Method ruxsat etilmagan'}));
  }
  try{
    const html=await readFile(frontendFile,'utf8');
    const out=html.includes('id="avtodrom-relation-fix-v1"') ? html : html.replace('</body>',FIX+'</body>');
    res.statusCode=200;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma','no-cache');
    res.setHeader('Expires','0');
    res.setHeader('X-Avtodrom-Frontend','relation-fix-v1');
    return res.end(out);
  }catch(error){
    console.error('FRONTEND SERVE ERROR:',error?.message||error);
    res.statusCode=500;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    return res.end(JSON.stringify({error:'Frontend yuklanmadi'}));
  }
}
