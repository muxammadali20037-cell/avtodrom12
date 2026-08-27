import { readFile } from 'node:fs/promises';

const frontendFile = new URL('../frontend/index.html', import.meta.url);

const PATCH = String.raw`<script id="avtodrom-professional-relations-v1">
(function(){
  'use strict';

  const byId = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
  const normalize = value => String(value ?? '').trim().toLocaleLowerCase('uz-UZ').replace(/\s+/g,' ');
  const token = () => localStorage.getItem('avtodrom_token') || '';

  async function apiCall(path, options){
    const opts = options || {};
    const headers = Object.assign(
      {'Content-Type':'application/json'},
      token() ? {Authorization:'Bearer '+token()} : {},
      opts.headers || {}
    );
    const response = await fetch('/api'+path, Object.assign({}, opts, {headers}));
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; }
    catch { data = {error:text}; }
    if(!response.ok) throw new Error(data.error || data.message || ('HTTP '+response.status));
    return data;
  }

  function setSelectValue(select, value){
    if(!select || value == null || value === '') return false;
    const wanted = String(value);
    let option = Array.from(select.options).find(o => String(o.value) === wanted);
    if(!option){
      option = document.createElement('option');
      option.value = wanted;
      option.textContent = wanted;
      select.appendChild(option);
    }
    select.value = wanted;
    return select.value === wanted;
  }

  function clearStudentDetail(){
    const box = byId('studentBox');
    if(box) box.innerHTML = '';
  }

  let studentsCache = [];
  let studentSearchTimer = null;
  let studentBound = false;

  async function loadAllStudents(){
    try{
      const data = await apiCall('/students');
      studentsCache = (Array.isArray(data) ? data : (data.rows || data.students || []))
        .slice()
        .sort((a,b) => normalize(a.full_name).localeCompare(normalize(b.full_name),'uz',{sensitivity:'base'}));
      return studentsCache;
    }catch(error){
      studentsCache = [];
      return [];
    }
  }

  function ensureStudentSearchUI(){
    const select = byId('student');
    if(!select) return null;

    let input = byId('studentSearchInput');
    if(!input){
      input = document.createElement('input');
      input.id = 'studentSearchInput';
      input.type = 'search';
      input.autocomplete = 'off';
      input.placeholder = 'O‘quvchi ism-familiyasini yozing yoki tanlang';
      input.setAttribute('list','studentSearchSuggestions');
      input.style.marginBottom = '8px';

      const list = document.createElement('datalist');
      list.id = 'studentSearchSuggestions';

      select.parentNode.insertBefore(input, select);
      select.style.display = 'none';
      select.setAttribute('aria-hidden','true');
      select.tabIndex = -1;

      if(!byId('studentId')){
        const hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.id = 'studentId';
        select.parentNode.appendChild(hidden);
      }

      if(!byId('studentSearchStatus')){
        const status = document.createElement('div');
        status.id = 'studentSearchStatus';
        status.className = 'muted';
        status.style.cssText = 'font-size:12px;margin-top:4px';
        input.parentNode.appendChild(list);
        input.parentNode.appendChild(status);
      }else{
        input.parentNode.appendChild(list);
      }

      input.addEventListener('input', () => {
        clearTimeout(studentSearchTimer);
        const value = input.value;
        studentSearchTimer = setTimeout(() => searchAndApplyStudent(value), 180);
      });

      input.addEventListener('change', () => searchAndApplyStudent(input.value));
      input.addEventListener('blur', () => {
        if(input.value.trim()) searchAndApplyStudent(input.value);
      });
    }

    return input;
  }

  function renderStudentSuggestions(query){
    const list = byId('studentSearchSuggestions');
    if(!list) return;
    const q = normalize(query);
    const schoolId = String(byId('school')?.value || '');
    const rows = studentsCache
      .filter(s => !schoolId || String(s.school_id || '') === schoolId)
      .filter(s => !q || normalize(s.full_name).includes(q))
      .slice(0,100);

    list.innerHTML = rows.map(s =>
      '<option value="'+escapeHtml(s.full_name||'')+'" label="'+
      escapeHtml((s.school_name||'')+' • '+(s.group_name||'')+' • '+Number(s.attendance_count||0)+' dars')+
      '"></option>'
    ).join('');

    const status = byId('studentSearchStatus');
    if(status){
      status.textContent = q ? rows.length+' ta o‘quvchi topildi' : 'O‘quvchini yozing yoki ro‘yxatdan tanlang';
    }
  }

  function showStudentCard(student){
    const box = byId('studentBox');
    if(!box || !student) return;
    const attendance = Number(student.attendance_count || 0);
    const badgeClass = attendance >= 12 ? 'blue' : attendance >= 6 ? 'red' : '';
    box.innerHTML =
      '<div class="attendance">'+
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap">'+
          '<div><b style="font-size:18px">'+escapeHtml(student.full_name||'')+'</b>'+\
          '<div class="muted">'+escapeHtml(student.phone||'Telefon yo‘q')+'</div></div>'+\
          '<span class="badge '+badgeClass+'">'+attendance+' marta qatnashgan</span>'+\
        '</div>'+\
        '<div class="attGrid">'+\
          '<div class="att"><b>'+escapeHtml(student.school_name||'—')+'</b><span class="muted">Avtoshkola</span></div>'+\
          '<div class="att"><b>'+escapeHtml(student.group_name||'—')+'</b><span class="muted">Guruh</span></div>'+\
          '<div class="att"><b>'+escapeHtml(student.plate||'—')+'</b><span class="muted">Avtomobil</span></div>'+\
          '<div class="att"><b>'+attendance+'</b><span class="muted">Kelgan dars</span></div>'+\
        '</div>'+\
      '</div>';
  }

  async function applyStudent(student){
    if(!student) return;

    const search = ensureStudentSearchUI();
    if(search) search.value = student.full_name || '';

    const select = byId('student');
    const hidden = byId('studentId');
    setSelectValue(select, student.id);
    if(hidden) hidden.value = String(student.id || '');

    const school = byId('school');
    const group = byId('group');

    if(school && student.school_id){
      school.disabled = false;
      setSelectValue(school, student.school_id);
      if(typeof window.groupsForSchool === 'function'){
        try{ await window.groupsForSchool(); }catch{}
      }
    }

    if(group && student.group_id){
      setSelectValue(group, student.group_id);
      group.disabled = false;
    }

    showStudentCard(student);
  }

  async function searchAndApplyStudent(value){
    const q = normalize(value);
    renderStudentSuggestions(value);

    const hidden = byId('studentId');
    const select = byId('student');

    if(!q){
      if(hidden) hidden.value = '';
      if(select) select.value = '';
      clearStudentDetail();
      return;
    }

    if(!studentsCache.length) await loadAllStudents();

    const schoolId = String(byId('school')?.value || '');
    const pool = studentsCache.filter(s => !schoolId || String(s.school_id || '') === schoolId);

    const exact = pool.filter(s => normalize(s.full_name) === q);
    const starts = pool.filter(s => normalize(s.full_name).startsWith(q));
    const contains = pool.filter(s => normalize(s.full_name).includes(q));
    const matches = exact.length ? exact : (starts.length ? starts : contains);

    if(matches.length === 1){
      await applyStudent(matches[0]);
      return;
    }

    if(hidden) hidden.value = '';
    if(matches.length > 1){
      const status = byId('studentSearchStatus');
      if(status) status.textContent = matches.length+' ta o‘quvchi topildi — ism-familiyani aniqroq yozing yoki ro‘yxatdan tanlang';
    }
  }

  async function bindStudentRelation(){
    if(studentBound) return;
    const type = byId('type');
    const student = byId('student');
    if(!type || !student) return;

    studentBound = true;
    const search = ensureStudentSearchUI();

    if(search) search.disabled = type.value !== 'school';
    if(student) student.disabled = false;

    await loadAllStudents();
    renderStudentSuggestions(search?.value || '');

    if(type){
      type.addEventListener('change', async () => {
        const schoolMode = type.value === 'school';
        if(search) search.disabled = !schoolMode;
        if(!schoolMode){
          const hidden = byId('studentId');
          if(hidden) hidden.value = '';
          if(student) student.value = '';
          if(search) search.value = '';
          clearStudentDetail();
        }else{
          await loadAllStudents();
          renderStudentSuggestions(search?.value || '');
        }
      });
    }

    byId('school')?.addEventListener('change', async () => {
      if(type?.value !== 'school') return;
      const currentSearch = byId('studentSearchInput')?.value || '';
      if(currentSearch) await searchAndApplyStudent(currentSearch);
      else renderStudentSuggestions('');
    });
  }

  let instructorCache = [];
  let instructorListenerBound = false;

  async function loadInstructorRelation(){
    try{
      const data = await apiCall('/instructors');
      instructorCache = Array.isArray(data) ? data : (data.items || data.instructors || data.rows || []);
    }catch{
      instructorCache = [];
    }
    ensureInstructorListener();
  }

  function parseInstructorPlate(value){
    const raw = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g,'');
    let m = raw.match(/^(\d{2})([A-Z])(\d{3})([A-Z]{2})$/);
    if(m) return {region:m[1], body:m[2]+m[3]+m[4]};
    m = raw.match(/^(\d{2})(\d{3}[A-Z]{3})$/);
    if(m) return {region:m[1], body:m[2]};
    m = raw.match(/^([A-Z])(\d{3})([A-Z]{2})$/);
    if(m) return {region:'', body:m[1]+m[2]+m[3]};
    m = raw.match(/^(\d{3})([A-Z]{3})$/);
    if(m) return {region:'', body:raw};
    return null;
  }

  function applyInstructorVehicle(instructor){
    if(!instructor) return;

    const model = byId('model');
    const driver = byId('driver');
    const region = byId('region');
    const plate = byId('plateBody');

    if(model && instructor.vehicle_model) model.value = instructor.vehicle_model;
    if(driver && !driver.value.trim() && instructor.driver_name) driver.value = instructor.driver_name;

    const parsed = parseInstructorPlate(instructor.vehicle_plate);
    if(parsed){
      if(region && parsed.region) setSelectValue(region, parsed.region);
      if(plate && parsed.body) plate.value = parsed.body.toUpperCase().slice(0,6);
      const err = byId('plateErr');
      if(err) err.textContent = '';
    }
  }

  function ensureInstructorListener(){
    const select = byId('v3Instructor');
    if(!select || instructorListenerBound) return;
    instructorListenerBound = true;

    const apply = () => {
      const id = String(select.value || '');
      const instructor = instructorCache.find(x => String(x.id) === id);
      if(instructor) applyInstructorVehicle(instructor);
    };

    select.addEventListener('change', apply);
    apply();
  }

  const nativeLoadInstructors = window.v3LoadInstructors;
  if(typeof nativeLoadInstructors === 'function'){
    window.v3LoadInstructors = async function(){
      await nativeLoadInstructors.apply(this, arguments);
      try{ await loadInstructorRelation(); }catch{}
      setTimeout(ensureInstructorListener,0);
    };
  }else{
    loadInstructorRelation();
  }

  async function boot(){
    try{ await bindStudentRelation(); }catch{}
    setTimeout(() => { try { ensureInstructorListener(); } catch {} }, 150);
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded', boot, {once:true});
  }else{
    boot();
  }
})();
<\/script>`;

export default async function handler(req,res){
  if(req.method!=='GET'){
    res.statusCode=405;
    res.setHeader('Allow','GET');
    return res.end(JSON.stringify({error:'Method ruxsat etilmagan'}));
  }
  try{
    const html=await readFile(frontendFile,'utf8');
    const out=html.includes('id="avtodrom-professional-relations-v1"') ? html : html.replace('</body>',PATCH+'</body>');
    res.statusCode=200;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma','no-cache');
    res.setHeader('Expires','0');
    res.setHeader('X-Avtodrom-Frontend','professional-relations-v1');
    return res.end(out);
  }catch(error){
    console.error('FRONTEND SERVE ERROR:',error?.message||error);
    res.statusCode=500;
    res.setHeader('Content-Type','application/json; charset=utf-8');
    return res.end(JSON.stringify({error:'Frontend yuklanmadi'}));
  }
}
