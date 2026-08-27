(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const norm = value => String(value ?? '').trim().toLocaleLowerCase('uz-UZ').replace(/\s+/g, ' ');
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));

  let studentsCache = [];
  let instructorsCache = [];
  let studentTimer = null;
  let instructorObserver = null;
  let bound = false;

  async function loadStudents() {
    try {
      const data = await window.api('/students');
      studentsCache = (Array.isArray(data) ? data : (data?.rows || data?.students || []))
        .slice()
        .sort((a,b) => String(a.full_name || '').localeCompare(String(b.full_name || ''), 'uz', {sensitivity:'base'}));
    } catch {
      studentsCache = [];
    }
    return studentsCache;
  }

  async function loadInstructors() {
    try {
      const data = await window.api('/instructors');
      instructorsCache = Array.isArray(data) ? data : (data?.rows || data?.items || data?.instructors || []);
    } catch {
      instructorsCache = [];
    }
    return instructorsCache;
  }

  function setSelect(select, value) {
    if (!select || value == null || value === '') return false;
    const wanted = String(value);
    let option = Array.from(select.options).find(o => String(o.value) === wanted);
    if (!option) {
      option = document.createElement('option');
      option.value = wanted;
      option.textContent = wanted;
      select.appendChild(option);
    }
    select.value = wanted;
    return select.value === wanted;
  }

  function parseInstructorPlate(value) {
    const raw = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!raw) return null;
    const hasRegion = raw.length >= 8 && /^\d{2}/.test(raw);
    const region = hasRegion ? raw.slice(0,2) : '';
    const body = hasRegion ? raw.slice(2) : raw;
    if (!/^(?:[A-Z]\d{3}[A-Z]{2}|\d{3}[A-Z]{3})$/.test(body)) return {region, body};
    return { region, body };
  }

  function applyInstructorToStart(instructor) {
    if (!instructor) return;
    const model = $('model');
    const plateBody = $('plateBody');
    const region = $('region');

    if (model && instructor.vehicle_model) model.value = instructor.vehicle_model;

    if (plateBody && instructor.vehicle_plate) {
      const parsed = parseInstructorPlate(instructor.vehicle_plate);
      if (parsed) {
        if (region && parsed.region) setSelect(region, parsed.region);
        plateBody.value = parsed.body;
      }
    }
  }

  function bindInstructorSelect() {
    const select = $('v3Instructor');
    if (!select || select.dataset.relationV4 === '1') return;
    select.dataset.relationV4 = '1';

    const apply = async () => {
      const id = String(select.value || '');
      if (!id) return;
      if (!instructorsCache.length) await loadInstructors();
      const instructor = instructorsCache.find(x => String(x.id) === id);
      if (instructor) applyInstructorToStart(instructor);
    };

    select.addEventListener('change', () => { apply().catch(() => {}); });
    setTimeout(() => apply().catch(() => {}), 0);
  }

  function ensureStudentSearch() {
    const select = $('student');
    if (!select) return null;

    let input = $('studentSearchV4');
    if (!input) {
      input = document.createElement('input');
      input.id = 'studentSearchV4';
      input.type = 'search';
      input.autocomplete = 'off';
      input.placeholder = 'O‘quvchi ism-familiyasini yozing yoki tanlang';
      input.style.marginBottom = '8px';
      input.setAttribute('list', 'studentSearchV4List');

      const list = document.createElement('datalist');
      list.id = 'studentSearchV4List';

      select.parentNode.insertBefore(input, select);
      select.style.display = 'none';
      select.setAttribute('aria-hidden', 'true');
      select.tabIndex = -1;

      let hidden = $('studentId');
      if (!hidden) {
        hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.id = 'studentId';
        select.parentNode.appendChild(hidden);
      }
      const status = document.createElement('div');
      status.id = 'studentSearchV4Status';
      status.className = 'muted';
      status.style.cssText = 'font-size:12px;margin-top:4px';
      input.parentNode.appendChild(list);
      input.parentNode.appendChild(status);

      input.addEventListener('input', () => {
        clearTimeout(studentTimer);
        const value = input.value;
        studentTimer = setTimeout(() => resolveStudent(value), 160);
      });
      input.addEventListener('change', () => resolveStudent(input.value));
      input.addEventListener('blur', () => {
        if (input.value.trim()) resolveStudent(input.value);
      });
    }
    return input;
  }

  function renderStudentOptions(value) {
    const list = $('studentSearchV4List');
    if (!list) return;
    const schoolId = String($('school')?.value || '');
    const q = norm(value);
    const rows = studentsCache
      .filter(s => !schoolId || String(s.school_id || '') === schoolId)
      .filter(s => !q || norm(s.full_name).includes(q))
      .slice(0, 100);
    list.innerHTML = rows.map(s =>
      '<option value="' + escapeHtml(s.full_name || '') + '" label="' +
      escapeHtml((s.school_name || '—') + ' • ' + (s.group_name || '—') + ' • ' + Number(s.attendance_count || 0) + ' dars') + '"></option>'
    ).join('');
    const status = $('studentSearchV4Status');
    if (status) status.textContent = q ? rows.length + ' ta o‘quvchi topildi' : 'O‘quvchini yozing yoki ro‘yxatdan tanlang';
  }

  async function resolveStudent(value) {
    const q = norm(value);
    if (!q) {
      if ($('studentId')) $('studentId').value = '';
      if ($('studentBox')) $('studentBox').innerHTML = '';
      renderStudentOptions('');
      return;
    }
    if (!studentsCache.length) await loadStudents();
    renderStudentOptions(value);

    const schoolId = String($('school')?.value || '');
    const pool = studentsCache.filter(s => !schoolId || String(s.school_id || '') === schoolId);
    const exact = pool.filter(s => norm(s.full_name) === q);
    const starts = pool.filter(s => norm(s.full_name).startsWith(q));
    const contains = pool.filter(s => norm(s.full_name).includes(q));
    const matches = exact.length ? exact : (starts.length ? starts : contains);

    if (matches.length !== 1) {
      if ($('studentId')) $('studentId').value = '';
      if ($('studentSearchV4Status') && matches.length > 1) {
        $('studentSearchV4Status').textContent = matches.length + ' ta o‘quvchi topildi — aniqroq ism-familiya yozing';
      }
      return;
    }

    const student = matches[0];
    const input = $('studentSearchV4');
    const select = $('student');
    if (input) input.value = student.full_name || '';
    if (select) setSelect(select, student.id);
    if ($('studentId')) $('studentId').value = String(student.id || '');

    const school = $('school');
    const group = $('group');
    if (school && student.school_id) {
      school.disabled = false;
      setSelect(school, student.school_id);
      if (typeof window.groupsForSchool === 'function') {
        try { await window.groupsForSchool(); } catch {}
      }
    }
    if (group) {
      group.disabled = true;
      if (student.group_id) setSelect(group, student.group_id);
      else group.value = '';
      group.setAttribute('data-auto', 'student');
    }

    const n = Number(student.attendance_count || 0);
    if ($('studentBox')) {
      $('studentBox').innerHTML =
        '<div class="attendance">' +
          '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap">' +
            '<div><b style="font-size:19px">' + escapeHtml(student.full_name || '') + '</b>' +
            '<div class="muted">' + escapeHtml(student.phone || 'Telefon yo‘q') + '</div></div>' +
            '<span class="badge ' + (n >= 12 ? 'blue' : n >= 6 ? 'red' : '') + '">' + n + ' marta qatnashgan</span>' +
          '</div>' +
          '<div class="attGrid">' +
            '<div class="att"><b>' + escapeHtml(student.school_name || '—') + '</b><span class="muted">Avtoshkola</span></div>' +
            '<div class="att"><b>' + escapeHtml(student.group_name || '—') + '</b><span class="muted">Guruh</span></div>' +
            '<div class="att"><b>' + escapeHtml(student.plate || '—') + '</b><span class="muted">Avtomobil</span></div>' +
            '<div class="att"><b>' + n + '</b><span class="muted">Kelgan dars</span></div>' +
          '</div>' +
        '</div>';
    }
  }

  function patchStartPayload() {
    const original = window.v3StartPayload;
    if (typeof original !== 'function' || original.__relationV4) return;
    const wrapped = function () {
      const payload = original();
      if (String($('type')?.value || '') === 'school') {
        const studentId = String($('studentId')?.value || '');
        const student = studentsCache.find(s => String(s.id) === studentId);
        if (student) {
          payload.studentId = student.id;
          payload.schoolId = student.school_id;
          payload.groupId = student.group_id || null;
        }
      }
      return payload;
    };
    wrapped.__relationV4 = true;
    window.v3StartPayload = wrapped;
  }

  function init() {
    if (bound) return;
    bound = true;
    ensureStudentSearch();
    loadStudents().then(() => {
      renderStudentOptions($('studentSearchV4')?.value || '');
    }).catch(() => {});

    const type = $('type');
    if (type) {
      type.addEventListener('change', () => {
        const school = type.value === 'school';
        const input = ensureStudentSearch();
        if (input) input.disabled = !school;
        if (!school) {
          if ($('studentId')) $('studentId').value = '';
          if (input) input.value = '';
        } else {
          loadStudents().then(() => renderStudentOptions(input?.value || '')).catch(() => {});
        }
      });
    }

    const school = $('school');
    if (school) school.addEventListener('change', () => {
      renderStudentOptions($('studentSearchV4')?.value || '');
    });

    patchStartPayload();
    bindInstructorSelect();

    if (!instructorObserver) {
      instructorObserver = new MutationObserver(() => {
        patchStartPayload();
        bindInstructorSelect();
      });
      instructorObserver.observe(document.body, {childList:true,subtree:true});
    }

    setTimeout(() => {
      patchStartPayload();
      bindInstructorSelect();
      const input = ensureStudentSearch();
      if (input) input.disabled = String($('type')?.value || '') !== 'school';
    }, 120);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();
