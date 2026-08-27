import { readFile } from 'node:fs/promises';

const frontendFile = new URL('../frontend/index.html', import.meta.url);

const FRONTEND_HELPER = `<script>
(function () {
  'use strict';

  if (typeof window.parsePlate !== 'function') {
    window.parsePlate = function (value) {
      const q = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!q) return null;

      let m = q.match(/^(\\d{2})([A-Z])(\\d{3})([A-Z]{2})$/);
      if (m) {
        return {
          region: m[1],
          body: m[2] + m[3] + m[4],
          firstLetter: m[2],
          number: m[3],
          lastLetters: m[4]
        };
      }

      m = q.match(/^([A-Z])(\\d{3})([A-Z]{2})$/);
      if (m) {
        return {
          body: q,
          firstLetter: m[1],
          number: m[2],
          lastLetters: m[3]
        };
      }

      m = q.match(/^(\\d{3})([A-Z]{3})$/);
      if (m) {
        return {
          body: q,
          firstLetter: m[2][0],
          number: m[1],
          lastLetters: m[2].slice(1)
        };
      }

      return null;
    };
  }

  function installStudentAutofill() {
    const type = document.getElementById('type');
    const school = document.getElementById('school');
    const group = document.getElementById('group');
    const student = document.getElementById('student');
    const studentId = document.getElementById('studentId');
    const dataList = document.getElementById('studentSuggestions');

    if (!type || !school || !group || !student || !studentId || !dataList) return;
    if (student.dataset.autofillInstalled === '1') return;
    student.dataset.autofillInstalled = '1';

    const norm = (value) => String(value ?? '').trim().toLocaleLowerCase('uz').replace(/\\s+/g, ' ');
    const sortStudents = (items) => (Array.isArray(items) ? items : []).slice().sort((a, b) =>
      norm(a.full_name).localeCompare(norm(b.full_name), 'uz', { sensitivity: 'base' })
    );

    let allStudents = [];
    let timer = null;
    let loading = false;

    async function loadStudents() {
      if (loading) return allStudents;
      loading = true;
      try {
        const token = localStorage.getItem('avtodrom_token') || '';
        const response = await fetch('/api/students', {
          headers: token ? { Authorization: 'Bearer ' + token } : {}
        });
        if (!response.ok) throw new Error('O‘quvchilarni yuklab bo‘lmadi.');
        const data = await response.json();
        allStudents = sortStudents(Array.isArray(data) ? data : (data?.rows || data?.students || []));
        return allStudents;
      } finally {
        loading = false;
      }
    }

    function renderSuggestions(items) {
      const seen = new Set();
      dataList.innerHTML = sortStudents(items).filter(s => {
        const id = String(s?.id || '');
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      }).map(s => {
        const meta = [s.school_name, s.group_name].filter(Boolean).join(' • ');
        const count = Number(s.attendance_count || 0);
        return '<option value="' + String(s.full_name || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') + '" label="' + String(meta + ' — ' + count + ' dars').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') + '"></option>';
      }).join('');
    }

    function enableSchoolStudentMode() {
      const isSchool = type.value === 'school';
      school.disabled = !isSchool;
      student.disabled = !isSchool;
      if (!isSchool) {
        group.disabled = true;
        studentId.value = '';
        dataList.innerHTML = '';
        return;
      }
      // Guruh tanlash majburiy emas: avval o‘quvchini yozish mumkin.
      group.disabled = !school.value;
      if (!school.value) group.innerHTML = '<option value="">O‘quvchi tanlang — guruh avtomatik aniqlanadi</option>';
      loadStudents().then(renderSuggestions).catch(() => {});
    }

    async function applyStudent(value) {
      const q = norm(value);
      if (!q) {
        studentId.value = '';
        return;
      }

      try {
        if (!allStudents.length) await loadStudents();
        const currentSchool = String(school.value || '');
        const currentGroup = String(group.value || '');
        let pool = allStudents;

        if (currentSchool && currentGroup) {
          const filtered = allStudents.filter(s => String(s.school_id || '') === currentSchool && String(s.group_id || '') === currentGroup);
          if (filtered.length) pool = filtered;
        } else if (currentSchool) {
          const filtered = allStudents.filter(s => String(s.school_id || '') === currentSchool);
          if (filtered.length) pool = filtered;
        }

        const exact = pool.filter(s => norm(s.full_name) === q);
        const matches = exact.length ? exact : pool.filter(s => norm(s.full_name).includes(q));

        if (matches.length !== 1) {
          studentId.value = '';
          renderSuggestions(matches.slice(0, 100));
          return;
        }

        const selected = matches[0];
        student.value = String(selected.full_name || '');
        studentId.value = String(selected.id || '');
        renderSuggestions([selected]);

        // O‘quvchining avtoshkolasi avtomatik tanlanadi.
        if (selected.school_id) {
          if (typeof window.loadSchoolSelect === 'function') await window.loadSchoolSelect();
          school.value = String(selected.school_id);
        }

        // Guruh avtomatik to‘ldiriladi; foydalanuvchi guruhni oldindan tanlashi shart emas.
        if (selected.school_id && typeof window.groupsForSchool === 'function') {
          await window.groupsForSchool();
          if (selected.group_id) {
            group.value = String(selected.group_id);
            group.disabled = false;
          }
        }

        if (typeof window.studentInfo === 'function') window.studentInfo();
      } catch (error) {
        console.warn('Student auto-fill:', error?.message || error);
      }
    }

    type.addEventListener('change', enableSchoolStudentMode);
    school.addEventListener('change', () => {
      studentId.value = '';
      if (type.value === 'school') {
        group.disabled = false;
        if (typeof window.groupsForSchool === 'function') window.groupsForSchool();
      }
    });

    student.addEventListener('input', () => {
      clearTimeout(timer);
      studentId.value = '';
      const value = student.value;
      if (type.value !== 'school') return;
      timer = setTimeout(() => applyStudent(value), 220);
    });

    student.addEventListener('change', () => applyStudent(student.value));
    student.addEventListener('blur', () => {
      if (norm(student.value)) applyStudent(student.value);
    });

    enableSchoolStudentMode();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installStudentAutofill, { once: true });
  } else {
    installStudentAutofill();
  }
})();
</script>`;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Method ruxsat etilmagan' }));
  }

  try {
    const html = await readFile(frontendFile, 'utf8');

    // Canonical frontend is served untouched. The only addition is a small,
    // isolated compatibility/relation helper loaded before the app scripts.
    const out = html.includes('data-autofill-installed') || html.includes('installStudentAutofill')
      ? html
      : html.replace('</head>', FRONTEND_HELPER + '</head>');

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('X-Avtodrom-Frontend', 'canonical-clean-v6');
    return res.end(out);
  } catch (error) {
    console.error('FRONTEND SERVE ERROR:', error?.message || error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Frontend yuklanmadi' }));
  }
}
