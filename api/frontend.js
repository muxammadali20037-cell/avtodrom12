import { readFile } from 'node:fs/promises';

const frontendFile = new URL('../frontend/index.html', import.meta.url);

const RELATION_PATCH = `<script>
(function(){
  'use strict';

  function escLocal(v){
    return String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  }

  function installRelationPatch(){
    if(typeof window.$!=='function' || typeof window.api!=='function') return;

    const type=window.$('type'), school=window.$('school'), group=window.$('group'), student=window.$('student'), studentId=window.$('studentId');
    if(type && !type.dataset.relationPatch){
      type.dataset.relationPatch='1';
      type.addEventListener('change',()=>{
        const on=type.value==='school';
        if(student) student.disabled=!on;
        if(group) group.disabled=!on;
        if(on){
          if(typeof window.loadAllStudentsForSearch==='function') window.loadAllStudentsForSearch().catch(()=>{});
          if(group && !group.value) group.innerHTML='<option value="">Guruh — o‘quvchidan avtomatik aniqlanadi</option>';
        }
      });
    }

    if(school && !school.dataset.relationPatch){
      school.dataset.relationPatch='1';
      school.addEventListener('change',()=>{
        if(type && type.value==='school' && student) student.disabled=false;
        if(type && type.value==='school' && typeof window.groupsForSchool==='function') window.groupsForSchool();
      });
    }

    if(student && !student.dataset.relationPatch){
      student.dataset.relationPatch='1';
      let timer=null;
      const run=()=>{
        clearTimeout(timer);
        const value=student.value.trim();
        if(!value || !type || type.value!=='school') return;
        timer=setTimeout(()=>{
          if(typeof window.applyStudentByName==='function') window.applyStudentByName(value).catch(()=>{});
        },180);
      };
      student.addEventListener('input',run);
      student.addEventListener('change',()=>{if(typeof window.applyStudentByName==='function') window.applyStudentByName(student.value).catch(()=>{})});
      student.addEventListener('blur',()=>{if(student.value.trim() && typeof window.applyStudentByName==='function') window.applyStudentByName(student.value).catch(()=>{})});
    }

    const form=window.$('startForm');
    if(form && !form.dataset.relationSubmitPatch){
      form.dataset.relationSubmitPatch='1';
      let resolving=false;
      form.addEventListener('submit',async e=>{
        if(resolving || !type || type.value!=='school') return;
        const sid=String(studentId?.value||'');
        const schoolId=String(school?.value||'');
        const groupId=String(group?.value||'');
        const name=String(student?.value||'').trim();
        if(!schoolId || !name) return;
        if(groupId && sid) return;

        e.preventDefault();
        resolving=true;
        try{
          if(typeof window.applyStudentByName==='function') await window.applyStudentByName(name);
          if(studentId?.value && school?.value){
            if(!group?.value){
              const selected=(window.students||[]).find(x=>String(x.id)===String(studentId.value));
              if(selected?.group_id && group){
                await (typeof window.groupsForSchool==='function'?window.groupsForSchool():Promise.resolve());
                group.value=String(selected.group_id);
              }
            }
            form.requestSubmit();
          }
        }finally{
          resolving=false;
        }
      },true);
    }

    // Instructor modal: school only. Group is intentionally not used.
    if(typeof window.v3InstructorModal==='function'){
      window.v3InstructorModal=async function(editId){
        const list=Array.isArray(window.V3?.instructors)?window.V3.instructors:[];
        const x=list.find(i=>String(i.id)===String(editId))||{};
        try{
          if(!Array.isArray(window.schools)||!window.schools.length) window.schools=await window.api('/schools')||[];
        }catch(e){ window.showToast?.(e.message,true); window.schools=[]; }
        const schoolOptions='<option value="">Avtoshkolani tanlang</option>'+
          (window.schools||[]).slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'uz',{sensitivity:'base'})).map(s=>
            '<option value="'+escLocal(s.id)+'" '+(String(s.id)===String(x.school_id)?'selected':'')+'>'+escLocal(s.name)+'</option>'
          ).join('');
        window.modal(
          '<div class="modalHead"><div><h2 style="margin:0">'+(editId?'Instruktorni tahrirlash':'Instruktor qo‘shish')+'</h2>'+\
          '<div class="muted">ID avtomatik yaratiladi. Instruktor uchun faqat avtoshkolani tanlash kifoya; guruh kerak emas.</div></div>'+\
          '<button class="btn light" type="button" onclick="closeModal()">Yopish</button></div>'+\
          '<div class="formGrid">'+\
          '<div class="fg"><label>F.I.Sh.</label><input id="v3iName" value="'+escLocal(x.full_name||x.name||'')+'" placeholder="Aliyev Ali"></div>'+\
          '<div class="fg"><label>Telefon</label><input id="v3iPhone" value="'+escLocal(x.phone||'')+'" placeholder="+998..." type="tel"></div>'+\
          '<div class="fg span2"><label>Avtoshkola</label><select id="v3iSchool">'+schoolOptions+'</select></div>'+\
          '<div class="fg"><label>Avtomobil raqami</label><input id="v3iPlate" value="'+escLocal(x.vehicle_plate||'')+'" placeholder="01 A 555 AA"></div>'+\
          '<div class="fg"><label>Avtomobil rusumi</label><input id="v3iModel" value="'+escLocal(x.vehicle_model||'')+'" placeholder="Chevrolet Cobalt"></div>'+\
          '<div class="fg"><label>Holati</label><select id="v3iActive"><option value="true" '+(x.active!==false?'selected':'')+'>Faol</option><option value="false" '+(x.active===false?'selected':'')+'>Nofaol</option></select></div>'+\
          '<div class="fg"><label>Biriktirish</label><div class="v3-note">Avtomobil bazadagi mavjud mashinadan tanlanadi. Bitta avtomobil bir vaqtning o‘zida ikki faol instruktorga biriktirilmaydi.</div></div>'+\
          '</div>'+\
          '<div class="actions"><button class="btn green" type="button" onclick="v3SaveInstructor(\\''+escLocal(editId||'')+'\\')">Saqlash</button><button class="btn light" type="button" onclick="closeModal()">Bekor</button></div>'+\
          '<div id="v3iErr" class="err"></div>'
        );
      };
    }

    window.v3SaveInstructor=async function(id){
      const err=window.$('v3iErr');
      try{
        const body={fullName:window.$('v3iName')?.value.trim()||'',phone:window.$('v3iPhone')?.value.trim()||'',schoolId:window.$('v3iSchool')?.value||'',vehiclePlate:window.$('v3iPlate')?.value.trim()||'',vehicleModel:window.$('v3iModel')?.value.trim()||'',active:window.$('v3iActive')?.value==='true'};
        if(!body.fullName) throw Error('F.I.Sh. kerak');
        if(!body.schoolId) throw Error('Avtoshkolani tanlang');
        await window.api(id?'/instructors/'+encodeURIComponent(id):'/instructors',{method:id?'PUT':'POST',body:JSON.stringify(body)});
        window.closeModal();
        if(typeof window.v3LoadInstructors==='function') await window.v3LoadInstructors();
        window.showToast?.('Instruktor saqlandi.');
      }catch(e){if(err)err.textContent=e.message||'Instruktor saqlanmadi'}
    };

    window.v3BulkInstructorModal=function(){
      if(typeof window.v3Esc!=='function') return;
      const opts='<option value="">Avtoshkolani tanlang</option>'+(window.schools||[]).slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'uz',{sensitivity:'base'})).map(s=>'<option value="'+window.v3Esc(s.id)+'">'+window.v3Esc(s.name)+'</option>').join('');
      window.modal('<div class="modalHead"><div><h2 style="margin:0">Instruktorlarni ommaviy qo‘shish</h2><div class="muted">Guruh talab qilinmaydi.</div></div><button class="btn light" type="button" onclick="closeModal()">Yopish</button></div>'+\
        '<div class="fg"><label>Avtoshkola</label><select id="v3BulkSchool">'+opts+'</select></div>'+\
        '<div class="fg"><label>Instruktorlar ro‘yxati</label><textarea id="v3iBulk" rows="9" style="width:100%;padding:12px;border:1px solid var(--line);border-radius:10px" placeholder="Aliyev Ali | +998901112233 | 01 A 555 AA | Chevrolet Cobalt\\nValiyev Vali | +998901234567 | 01 B 777 BB | Chevrolet Nexia"></textarea></div>'+\
        '<div class="actions"><button class="btn green" type="button" onclick="v3SaveBulkInstructors()">Saqlash</button><button class="btn light" type="button" onclick="closeModal()">Bekor</button></div><div id="v3iBulkErr" class="err"></div>');
    };
    window.v3SaveBulkInstructors=async function(){
      const lines=String(window.$('v3iBulk')?.value||'').split(/\\r?\\n/).map(x=>x.trim()).filter(Boolean);
      const schoolId=window.$('v3BulkSchool')?.value||'',err=window.$('v3iBulkErr');
      if(!schoolId){if(err)err.textContent='Avtoshkolani tanlang';return}
      if(!lines.length){if(err)err.textContent='Kamida bitta instruktor kiriting';return}
      try{
        for(const line of lines){const p=line.split('|').map(x=>x.trim());if(!p[0])continue;await window.api('/instructors',{method:'POST',body:JSON.stringify({fullName:p[0],phone:p[1]||'',schoolId,vehiclePlate:p[2]||'',vehicleModel:p[3]||'',active:true})})}
        window.closeModal();await window.v3LoadInstructors();window.showToast?.(lines.length+' ta instruktor qo‘shildi.');
      }catch(e){if(err)err.textContent=e.message||'Ommaviy qo‘shishda xatolik'}
    };
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',installRelationPatch,{once:true});
  else installRelationPatch();
})();
</script>`;

const PLATE_HELPER = `<script>
(function(){
  'use strict';
  if(typeof window.parsePlate==='function')return;
  window.parsePlate=function(value){
    const q=String(value??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(!q)return null;
    let m=q.match(/^(\\d{2})([A-Z])(\\d{3})([A-Z]{2})$/);
    if(m)return{region:m[1],body:m[2]+m[3]+m[4],firstLetter:m[2],number:m[3],lastLetters:m[4]};
    m=q.match(/^([A-Z])(\\d{3})([A-Z]{2})$/);
    if(m)return{body:q,firstLetter:m[1],number:m[2],lastLetters:m[4]};
    m=q.match(/^(\\d{3})([A-Z]{3})$/);
    if(m)return{body:q,firstLetter:m[2][0],number:m[1],lastLetters:m[2].slice(1)};
    return null;
  };
})();
</script>`;

export default async function handler(req,res){
  if(req.method!=='GET'){
    res.statusCode=405;
    res.setHeader('Allow','GET');
    res.setHeader('Content-Type','application/json; charset=utf-8');
    return res.end(JSON.stringify({error:'Method ruxsat etilmagan'}));
  }
  try{
    let html=await readFile(frontendFile,'utf8');
    if(!html.includes('data-relation-patch')){
      html=html.replace('</body>',RELATION_PATCH+PLATE_HELPER+'</body>');
    }
    res.statusCode=200;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma','no-cache');
    res.setHeader('Expires','0');
    res.setHeader('X-Avtodrom-Frontend','canonical-clean-v8');
    return res.end(html);
  }catch(error){
    console.error('FRONTEND SERVE ERROR:',error?.message||error);
    res.statusCode=500;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    return res.end(JSON.stringify({error:'Frontend yuklanmadi'}));
  }
}
