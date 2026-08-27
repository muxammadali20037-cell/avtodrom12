/* AVTODROM runtime relation bridge */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[m]));
  const parsePlate=function(raw){
    const q=String(raw??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    let m=q.match(/^(\d{2})([A-Z])(\d{3})([A-Z]{2})$/);
    if(m)return {region:m[1],body:q.slice(2),firstLetter:m[2],number:m[3],lastLetters:m[4]};
    m=q.match(/^([A-Z])(\d{3})([A-Z]{2})$/);
    if(m)return {body:q,firstLetter:m[1],number:m[2],lastLetters:m[3]};
    m=q.match(/^(\d{3})([A-Z]{3})$/);
    if(m)return {body:q,firstLetter:m[2][0],number:m[1],lastLetters:m[2].slice(1)};
    return null;
  };
  window.parsePlate=window.parsePlate||parsePlate;
  window.v3ParsePlate=window.v3ParsePlate||parsePlate;

  let list=[];
  async function refresh(){
    if(typeof window.api!=='function')return [];
    try{
      const d=await window.api('/instructors');
      list=Array.isArray(d)?d:(d?.items||d?.instructors||[]);
      window.__avtodromInstructorCache=list;
      return list;
    }catch(e){console.warn('Instructor relation bridge:',e?.message||e);return []}
  }
  function apply(inst){
    if(!inst)return;
    const p=parsePlate(inst.vehicle_plate||'');
    if(p){if(p.region&&$('region'))$('region').value=p.region;if($('plateBody'))$('plateBody').value=p.body;}
    if(inst.vehicle_model&&$('model'))$('model').value=inst.vehicle_model;
    if(inst.driver_name&&$('driver'))$('driver').value=inst.driver_name;
    if(inst.school_id&&$('school')){
      $('school').value=String(inst.school_id);
      const g=$('group');
      if(g&&typeof window.api==='function'){
        window.api('/groups?schoolId='+encodeURIComponent(inst.school_id)).then(gs=>{
          const arr=Array.isArray(gs)?gs:[];
          g.innerHTML='<option value="">Guruhni tanlang</option>'+arr.map(x=>'<option value="'+esc(x.id)+'" '+(String(x.id)===String(inst.group_id||'')?'selected':'')+'>'+esc(x.name)+'</option>').join('');
          g.disabled=$('type')?.value!=='school';
        }).catch(()=>{});
      }
    }
  }
  function bind(){
    const el=$('v3Instructor');
    if(!el||el.dataset.bridgeBound)return;
    el.dataset.bridgeBound='1';
    el.addEventListener('change',()=>apply(list.find(x=>String(x.id)===String(el.value))));
  }
  window.avtodromRefreshInstructorRelations=refresh;
  setTimeout(()=>{bind();refresh()},700);
  setInterval(bind,1000);
})();
