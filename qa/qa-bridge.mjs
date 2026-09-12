/* IKKI LOYIHA ULANISHI — soxta Avtodrom serveri bilan tekshiruv.
   avtodrom12 dagi /api/receipts/verify | redeem | complete
   mantiqini soxta baza ustida ishlatib ko'ramiz: chek bir marta
   ishlashi, bekor qilingani o'tmasligi, tekin qolishi. */
import http from 'node:http';
import crypto from 'node:crypto';

const KEY = 'test-shared-key-0123456789';
process.env.RECEIPT_SHARED_KEY = KEY;

/* ---- soxta baza (pool.query) ---- */
const DB = {
  receipts: [{
    id: 'r1', user_id: 'u1', code: 'AVD-1001', status: 'issued',
    student_id: 's1', school_id: 'sc1', group_id: 'g1',
    customer_name: null, customer_phone: '+998901112233',
    planned_minutes: 90, amount: 0, vehicle_plate: null,
    issued_at: new Date().toISOString(), scanned_at: null, session_id: null, scanned_by_name: null,
  }, {
    id: 'r2', user_id: 'u1', code: 'AVD-1002', status: 'cancelled',
    student_id: 's2', school_id: 'sc1', group_id: 'g1', planned_minutes: 60, amount: 0,
    issued_at: new Date().toISOString(),
  }],
  sessions: [], vehicles: [],
};
const students = { s1: { full_name: 'Aziz Rahimov', school_name: 'TASH INDEX', group_name: 'A-1' },
                   s2: { full_name: 'Dilnoza Karimova', school_name: 'TASH INDEX', group_name: 'A-1' } };

function fakeQuery(sql, params = []) {
  const t = sql.replace(/\s+/g, ' ').trim();
  if (/^BEGIN|^COMMIT|^ROLLBACK/.test(t)) return { rows: [] };
  if (/CREATE TABLE|CREATE .*INDEX|ALTER TABLE|^UPDATE instructors/i.test(t)) return { rows: [] };

  if (/SELECT r\.\*.*FROM receipts r/i.test(t)) {
    const r = DB.receipts.find(x => x.code === params[0]);
    return { rows: r ? [{ ...r, ...students[r.student_id] ? { student_name: students[r.student_id].full_name,
      school_name: students[r.student_id].school_name, group_name: students[r.student_id].group_name } : {} }] : [] };
  }
  if (/SELECT \* FROM receipts WHERE code=/i.test(t)) {
    const r = DB.receipts.find(x => x.code === params[0]);
    return { rows: r ? [r] : [] };
  }
  if (/FROM students st LEFT JOIN driving_schools/i.test(t)) {
    const st = students[params[0]];
    return { rows: st ? [st] : [] };
  }
  if (/SELECT id FROM vehicles WHERE plate=/i.test(t)) {
    const v = DB.vehicles.find(x => x.plate === params[0]);
    return { rows: v ? [{ id: v.id }] : [] };
  }
  if (/INSERT INTO vehicles/i.test(t)) {
    const v = { id: 'v' + (DB.vehicles.length + 1), plate: params[4] };
    DB.vehicles.push(v); return { rows: [{ id: v.id }] };
  }
  if (/SELECT id FROM sessions WHERE vehicle_id=/i.test(t)) {
    const s = DB.sessions.find(x => x.vehicle_id === params[0] && x.status === 'active');
    return { rows: s ? [{ id: s.id }] : [] };
  }
  if (/SELECT id FROM instructors/i.test(t)) return { rows: [{ id: 'i-local' }] };
  if (/FROM user_settings/i.test(t)) return { rows: [{ hourly_rate: 30000, minimum_payment: 0, calculation_mode: 'hour' }] };
  if (/INSERT INTO sessions/i.test(t)) {
    /* Summa SQL ning o'zida 0 yozilgan — shuni tekshiramiz */
    const freeInSql = /,0,0,0,'cash',0\)/.test(t);
    const s = { id: 'sess' + (DB.sessions.length + 1), vehicle_id: params[1], status: 'active',
      started_at: new Date(Date.now() - 3600000).toISOString(), student_id: params[7],
      amount: freeInSql ? 0 : -1, frozen_seconds: 0 };
    DB.sessions.push(s);
    return { rows: [{ id: s.id, started_at: s.started_at }] };
  }
  if (/UPDATE receipts SET status='scanned'/i.test(t)) {
    const r = DB.receipts.find(x => x.id === params[5]);
    Object.assign(r, { status: 'scanned', scanned_at: new Date().toISOString(), session_id: params[0],
      scanned_by_name: params[1], scanned_by_ref: params[2], external_booking_id: params[3],
      vehicle_plate: params[4] || r.vehicle_plate });
    return { rows: [r] };
  }
  if (/SELECT \* FROM sessions WHERE id=/i.test(t)) {
    const s = DB.sessions.find(x => x.id === params[0]);
    return { rows: s ? [s] : [] };
  }
  if (/UPDATE sessions SET finished_at=/i.test(t)) {
    const s = DB.sessions.find(x => x.id === params[3]);
    if (s) Object.assign(s, { status: 'completed', duration_seconds: params[1], amount: 0, lessons_counted: params[2] });
    return { rows: [] };
  }
  return { rows: [] };
}

/* pool ni almashtiramiz */
const dbMod = await import('/root/avtodrom12/backend/src/db.js').catch(() => null);
if (dbMod?.pool) {
  dbMod.pool.query = async (sql, p) => fakeQuery(sql, p);
  dbMod.pool.connect = async () => ({ query: async (sql, p) => fakeQuery(sql, p), release() {} });
}
const { handleReceiptRequest } = await import('/root/avtodrom12/api/receipt-routes.js');

/* ---- avtodrom12 ni soxta serverda ko'taramiz ---- */
const server = http.createServer(async (req, res) => {
  const handled = await handleReceiptRequest(req, res);
  if (!handled) { res.statusCode = 404; res.end('{}'); }
});
await new Promise(r => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const call = async (path, opt = {}, key = KEY) => {
  const r = await fetch(BASE + path, {
    ...opt, headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Receipt-Key': key } : {}), ...(opt.headers || {}) },
  });
  let d = {}; try { d = await r.json(); } catch {}
  return { status: r.status, d };
};

console.log('=== 1) KALIT HIMOYASI ===');
let x = await call('/api/receipts/verify?code=AVD-1001', {}, '');
console.log('  kalitsiz →', x.status, JSON.stringify(x.d.error), x.status === 401 ? '✅' : '❌');
x = await call('/api/receipts/verify?code=AVD-1001', {}, 'notrightkey0000000000000');
console.log('  noto\'g\'ri kalit →', x.status, x.status === 401 ? '✅' : '❌');

console.log('\n=== 2) TEKSHIRISH (ishlatmasdan) ===');
x = await call('/api/receipts/verify?code=AVD-1001');
console.log('  ', x.status, JSON.stringify(x.d.receipt));
console.log('  chek holati hali "issued":', DB.receipts[0].status === 'issued' ? '✅' : '❌');
x = await call('/api/receipts/verify?code=AVD-9999');
console.log('  yo\'q kod →', x.status, JSON.stringify(x.d.error), x.status === 404 ? '✅' : '❌');

console.log('\n=== 3) ISHLATISH (redeem) ===');
x = await call('/api/receipts/redeem', { method: 'POST', body: JSON.stringify({
  code: '1001', instructor_name: 'Shaxzod Ruziqulov', instructor_ref: 'ip-77', vehicle_plate: '01 111QQQ',
  external_booking_id: 'bk-1' }) });
console.log('  ', x.status, JSON.stringify(x.d));
console.log('  o\'quvchi ismi:', x.d.receipt?.student_name, '| tekin:', x.d.receipt?.free === true ? '✅' : '❌');
console.log('  avtodrom12 da sessiya ochildi:', DB.sessions.length === 1 ? '✅' : '❌',
            '| summa:', DB.sessions[0]?.amount, DB.sessions[0]?.amount === 0 ? '✅ tekin' : '❌');
console.log('  chekda kim skanerlagani:', DB.receipts[0].scanned_by_name, '| bron:', DB.receipts[0].external_booking_id);

console.log('\n=== 4) TAKROR VA BEKOR ===');
x = await call('/api/receipts/redeem', { method: 'POST', body: JSON.stringify({ code: 'AVD-1001', instructor_name: 'Boshqa instruktor' }) });
console.log('  ikkinchi marta →', x.status, JSON.stringify(x.d.error), x.status === 409 ? '✅ to\'sildi' : '❌');
x = await call('/api/receipts/redeem', { method: 'POST', body: JSON.stringify({ code: 'AVD-1002' }) });
console.log('  bekor qilingan →', x.status, JSON.stringify(x.d.error), x.status === 409 ? '✅ to\'sildi' : '❌');
console.log('  sessiyalar soni hali 1:', DB.sessions.length === 1 ? '✅' : '❌');

console.log('\n=== 5) YAKUNLASH (complete) ===');
x = await call('/api/receipts/complete', { method: 'POST', body: JSON.stringify({ code: 'AVD-1001' }) });
console.log('  ', x.status, JSON.stringify(x.d));
const s = DB.sessions[0];
console.log('  sessiya holati:', s.status, '| summa:', s.amount, '| daqiqa:', Math.round(s.duration_seconds / 60), '| dars:', s.lessons_counted);
console.log('  pul yozilmadi:', Number(s.amount) === 0 ? '✅' : '❌');
x = await call('/api/receipts/complete', { method: 'POST', body: JSON.stringify({ code: 'AVD-1001' }) });
console.log('  ikkinchi yakunlash →', x.status, JSON.stringify(x.d.note));

console.log('\n=== 6) RAQAMSIZ / NOTO\'G\'RI KOD ===');
for (const c of ['ABC', 'AVD-260901-6KBCQ', '12']) {
  const r = await call('/api/receipts/redeem', { method: 'POST', body: JSON.stringify({ code: c }) });
  console.log('  ', JSON.stringify(c), '→', r.status, JSON.stringify(r.d.error));
}

server.close();
