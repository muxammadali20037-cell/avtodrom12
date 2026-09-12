/* QR CHEK (avtoshkola) — to'liq tekshiruv.
   1) Chek beriladigan avtoshkola belgilanadi va saqlanadi
   2) Chek faqat o'sha shkola o'quvchisiga chiqadi, pul so'ralmaydi,
      instruktor tanlanmaydi
   3) Dars tekin, instruktor tanlanmaydi
   4) Boshqa bo'limlarda regressiya yo'q
   ESLATMA: skaner bu loyihada EMAS — u Avtodrom instruktor panelida.
   Ulanish tekshiruvi: qa-bridge.mjs */
import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import http from 'node:http';
import fs from 'node:fs';

const server = http.createServer((q, r) => {
  r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  r.end(fs.readFileSync('../index.html'));
});
await new Promise(r => server.listen(0, r));
const P = server.address().port;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });

const stub = () => {
  try {
    localStorage.setItem('avtodrom_token', 'fake.jwt');
    localStorage.setItem('avtodrom_user', JSON.stringify({ id: 'u1', username: 'operator' }));
  } catch (e) {}
  window.qrcode = () => ({ addData() {}, make() {}, createSvgTag: () => '<svg data-fake="1"></svg>' });
  const J = (o, st) => new Response(JSON.stringify(o), { status: st || 200, headers: { 'content-type': 'application/json' } });
  const schools = [{ id: 'sc1', name: 'TASH INDEX', active: true }, { id: 'sc2', name: 'YOSHLIK AVTO', active: true }];
  const students = [
    { id: 's1', full_name: 'Aziz Rahimov', school_id: 'sc1', school_name: 'TASH INDEX', group_id: 'g1', group_name: 'A-1', active: true },
    { id: 's2', full_name: 'Dilnoza Karimova', school_id: 'sc1', school_name: 'TASH INDEX', group_id: 'g1', group_name: 'A-1', active: true },
    { id: 's3', full_name: 'Bobur Yo‘ldoshev', school_id: 'sc2', school_name: 'YOSHLIK AVTO', group_id: 'g9', group_name: 'B-2', active: true },
  ];
  window.__cfg = { school_id: null, default_minutes: 60 };
  window.__receipts = [];
  window.__scanned = [];
  window.__posted = [];
  window.fetch = async (url, opt) => {
    const u = String(url).split('?')[0];
    const m = (opt?.method || 'GET').toUpperCase();
    if (u === '/api/schools') return J(schools);
    if (u === '/api/students') return J(students);
    if (u === '/api/instructors') return J([{ id: 'i1', full_name: 'Shaxzod Ruziqulov', vehicle_plate: '01 111QQQ', active: true }]);
    if (u === '/api/settings') return J({ hourlyRate: 30000 });
    if (u === '/api/sessions/active' || u === '/api/sessions/frozen') return J([]);
    if (u === '/api/groups') return J([]);

    if (u === '/api/receipts/config' && m === 'GET') {
      const s = schools.find(x => x.id === window.__cfg.school_id) || null;
      return J({ ...window.__cfg, school: s });
    }
    if (u === '/api/receipts/config') {
      const b = JSON.parse(opt.body);
      window.__cfg = { school_id: b.school_id || null, default_minutes: b.default_minutes || 60 };
      const s = schools.find(x => x.id === window.__cfg.school_id) || null;
      return J({ ...window.__cfg, school: s });
    }
    if (u === '/api/receipts' && m === 'POST') {
      const b = JSON.parse(opt.body); window.__posted.push(b);
      const st = students.find(x => x.id === b.student_id);
      if (!window.__cfg.school_id) return J({ error: 'Avval chek beriladigan avtoshkolani belgilang' }, 400);
      if (!st || st.school_id !== window.__cfg.school_id) return J({ error: 'Bu o‘quvchi chek beriladigan avtoshkolaga tegishli emas' }, 400);
      if (window.__receipts.some(r => r.student_id === st.id && r.status === 'issued'))
        return J({ error: 'Bu o‘quvchida ishlatilmagan chek bor' }, 409);
      const rec = {
        id: 'r' + (window.__receipts.length + 1), code: 'AVD-' + (1001 + window.__receipts.length),
        status: 'issued', student_id: st.id, student_name: st.full_name, school_name: st.school_name,
        group_name: st.group_name, planned_minutes: b.planned_minutes, amount: 0, instructor_name: null,
      };
      window.__receipts.push(rec);
      return J({ receipt: rec }, 201);
    }
    if (u === '/api/receipts' && m === 'GET') {
      const rows = window.__receipts;
      return J({ receipts: rows, summary: {
        total: rows.length, open: rows.filter(r => r.status === 'issued').length,
        scanned: rows.filter(r => r.status === 'scanned').length,
        cancelled: rows.filter(r => r.status === 'cancelled').length } });
    }
    if (/\/api\/receipts\/[^/]+\/cancel$/.test(u)) {
      const r = window.__receipts.find(x => x.id === u.split('/')[3]); if (r) r.status = 'cancelled';
      return J({ receipt: r });
    }
    if (/\/api\/instructors\/[^/]+\/link$/.test(u)) return J({ token: 'abc', path: '/instructor.html?t=abc' });

    /* instruktor paneli */
    if (u === '/api/instructor/panel') {
      const act = window.__scanned.find(x => x.status === 'active') || null;
      return J({
        instructor: { id: 'i1', full_name: 'Shaxzod Ruziqulov', vehicle_plate: '01 111QQQ' },
        active: act, rows: window.__scanned,
        summary: { total: window.__scanned.length, done: window.__scanned.filter(x => x.status === 'completed').length,
          minutes: window.__scanned.reduce((a, x) => a + (x.duration_minutes || 0), 0),
          school: window.__scanned.filter(x => x.is_school).length },
      });
    }
    if (u === '/api/instructor/scan') {
      const b = JSON.parse(opt.body);
      const code = /^\d{4,5}$/.test(b.code) ? 'AVD-' + b.code : b.code;
      const rec = window.__receipts.find(x => x.code === code);
      if (!rec) return J({ error: code + ' — bunday chek topilmadi' }, 404);
      if (rec.status === 'scanned') return J({ error: 'Bu chek allaqachon ishlatilgan' }, 409);
      if (rec.status === 'cancelled') return J({ error: 'Bu chek bekor qilingan' }, 409);
      rec.status = 'scanned'; rec.instructor_name = 'Shaxzod Ruziqulov';
      window.__scanned.unshift({ id: 'sess1', status: 'active', started_at: new Date().toISOString(),
        planned_minutes: rec.planned_minutes, receipt_code: rec.code, name: rec.student_name,
        school_name: rec.school_name, group_name: rec.group_name, plate: '01 111QQQ',
        is_school: true, duration_minutes: 0 });
      return J({ session: { id: 'sess1' }, receipt: { code: rec.code, planned_minutes: rec.planned_minutes },
        name: rec.student_name, school_name: rec.school_name }, 201);
    }
    if (u === '/api/instructor/finish') {
      const s = window.__scanned.find(x => x.status === 'active');
      if (s) { s.status = 'completed'; s.duration_minutes = 58; }
      return J({ session: s, minutes: 58, lessons: 1 });
    }
    return J([]);
  };
};

/* ===================== 1) OPERATOR ===================== */
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
await page.route('**', r => (new URL(r.request().url()).hostname === 'localhost' ? r.continue() : r.abort()));
page.setDefaultTimeout(8000);
await page.addInitScript(stub);
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(`http://localhost:${P}/`);
await page.waitForTimeout(1600);
await page.click('.nav-btn[data-p="kassa"]');
await page.waitForTimeout(800);

console.log('=== 1) CHEK OYNASI ===');
let v = await page.evaluate(() => ({
  title: $('pageTitle').textContent,
  schools: [...document.querySelectorAll('#kzSchool option')].map(o => o.textContent),
  hint: $('kzSchoolHint').innerText.trim(),
  hasPay: !!document.getElementById('kzPaySeg'),
  hasAmount: !!document.getElementById('kzAmount'),
  hasInstructor: !!document.getElementById('kzInstructor'),
  hasType: !!document.getElementById('kzTypeSeg'),
}));
console.log('  sarlavha:', v.title);
console.log('  avtoshkolalar:', v.schools.join(' | '));
console.log(' ', v.hint);
console.log('  to\'lov turi:', v.hasPay ? 'bor ❌' : "yo'q ✅",
            '| summa:', v.hasAmount ? 'bor ❌' : "yo'q ✅",
            '| instruktor tanlash:', v.hasInstructor ? 'bor ❌' : "yo'q ✅",
            '| platny/shkola tanlovi:', v.hasType ? 'bor ❌' : "yo'q ✅");

/* shkola tanlanmagan holda chek */
await page.fill('#kzSearch', 'Aziz'); await page.waitForTimeout(300);
const noSchool = await page.evaluate(() => ({ sug: $('kzSuggest').classList.contains('hidden') }));
await page.click('[data-act="kzIssue"]'); await page.waitForTimeout(400);
const e0 = await page.evaluate(() => ({ err: $('kzErr').textContent.trim(), posted: window.__posted.length }));
console.log('\n  shkola tanlanmagan → qidiruv yopiq:', noSchool.sug ? '✅' : '❌', '|', JSON.stringify(e0.err), '| yuborildi:', e0.posted);

/* ===================== 2) SHKOLANI BELGILASH ===================== */
console.log('\n=== 2) CHEK BERILADIGAN AVTOSHKOLA ===');
await page.selectOption('#kzSchool', 'sc1');
await page.waitForTimeout(700);
const cfg = await page.evaluate(() => ({ saved: window.__cfg, hint: $('kzSchoolHint').innerText.trim() }));
console.log('  saqlandi:', JSON.stringify(cfg.saved));
console.log(' ', cfg.hint);

/* boshqa shkola o'quvchisi chiqmasligi kerak */
await page.fill('#kzSearch', 'Bobur'); await page.waitForTimeout(400);
const other = await page.evaluate(() => $('kzSuggest').innerText.replace(/\s+/g, ' ').trim());
console.log('  boshqa shkola o\'quvchisi ("Bobur"):', JSON.stringify(other), other.includes('topilmadi') ? '✅ chiqmadi' : '❌');

/* ===================== 3) CHEK CHIQARISH ===================== */
console.log('\n=== 3) CHEK CHIQARISH ===');
await page.fill('#kzSearch', 'Aziz'); await page.waitForTimeout(400);
await page.click('#kzSuggest button'); await page.waitForTimeout(300);
await page.click('#kzMinSeg .seg-btn[data-m="90"]');
await page.click('[data-act="kzIssue"]'); await page.waitForTimeout(900);
const rc = await page.evaluate(() => ({
  body: window.__posted[window.__posted.length - 1],
  code: document.querySelector('#kzReceipt .code')?.textContent,
  qr: !!document.querySelector('#kzQr svg'),
  text: document.getElementById('kzReceipt')?.innerText.replace(/\s+/g, ' '),
}));
console.log('  serverga:', JSON.stringify(rc.body));
console.log('  chek:', rc.code, '| QR:', rc.qr ? '✅' : '❌');
console.log('  chek matni:', rc.text);

await page.click('[data-act="closeModal"]'); await page.waitForTimeout(700);
const list = await page.evaluate(() => ({
  summary: $('kzSummary').innerText.replace(/\s+/g, ' '),
  rows: [...document.querySelectorAll('.kz-row')].map(r => r.innerText.replace(/\s+/g, ' ').trim()),
  badge: $('kassaCount').textContent, focus: document.activeElement?.id,
}));
console.log('\n  bugungi cheklar:', list.summary);
console.log('  qator:', list.rows.join(' // '));
console.log('  nishon:', list.badge, '| kursor:', list.focus, list.focus === 'kzSearch' ? '✅' : '❌');

/* takroriy chek */
await page.fill('#kzSearch', 'Aziz'); await page.waitForTimeout(400);
await page.click('#kzSuggest button'); await page.waitForTimeout(200);
await page.click('[data-act="kzIssue"]'); await page.waitForTimeout(700);
const dup = await page.evaluate(() => $('kzErr').textContent.trim());
console.log('  ikkinchi chek:', JSON.stringify(dup), dup ? '✅ to\'sildi' : '❌');

/* ===================== 5) REGRESSIYA ===================== */
console.log('\n=== 5) BOSHQA BO\'LIMLAR ===');
for (const p of ['add', 'kassa', 'active', 'queue', 'finish', 'frozen', 'daily', 'instructors']) {
  const btn = await page.$(`.nav-btn[data-p="${p}"]`);
  if (!btn) { console.log('  ', p, '— tugma yo\'q'); continue; }
  await btn.click(); await page.waitForTimeout(350);
  const ok = await page.evaluate(pp => {
    const s = document.getElementById('p-' + pp);
    return { shown: s ? !s.classList.contains('hidden') : null, title: document.getElementById('pageTitle')?.textContent };
  }, p);
  console.log('  ', p.padEnd(12), ok.shown ? '✅' : '❌', '|', ok.title);
}

console.log('\n=== JS XATOLAR ===');
console.log(errs.length ? [...new Set(errs)].slice(0, 8).join('\n') : "  yo'q ✅");
await browser.close(); server.close();
