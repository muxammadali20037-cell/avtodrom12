/* PHASE 0.1 — FAQAT O'QISH uchun ko'prik kaliti (BRIDGE_READ_KEY) testi.
   Ishga tushirish:  node qa/qa-bridge-key.mjs   (soxta baza, tarmoqsiz)
   Tekshiradi:
     • BRIDGE_READ_KEY (X-Bridge-Key) uchta GET ko'prigini ochadi;
     • u bilan chek endpointlari (verify/redeem/complete/release) YOPIQ;
     • GET dan boshqa usul rad etiladi;
     • eski RECEIPT_SHARED_KEY (X-Receipt-Key) avvalgidek ishlaydi;
     • 32 belgidan qisqa BRIDGE_READ_KEY e'tiborsiz qoldiriladi. */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = 'shared-key-for-receipts-0123456789';
const READ = 'read-only-bridge-key-0123456789abcdef';
process.env.RECEIPT_SHARED_KEY = SHARED;
process.env.BRIDGE_READ_KEY = READ;
process.env.JWT_SECRET = 'test-jwt-secret-0123456789abcdef';
process.env.DATABASE_URL = 'postgres://u:p@127.0.0.1:1/x';

const writes = [];
const fakeQuery = async (sql) => {
  const s = String(sql);
  if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(s)) writes.push(s.slice(0, 50));
  return { rows: [], rowCount: 0 };
};
const dbMod = await import(path.join(ROOT, 'backend/src/db.js'));
dbMod.pool.query = fakeQuery;
dbMod.pool.connect = async () => ({ query: fakeQuery, release() {} });

const { handleBridgeRequest } = await import(path.join(ROOT, 'api/bridge-analytics.js'));
const { handleOwnerBridgeRequest } = await import(path.join(ROOT, 'api/bridge-owner.js'));
const { handleEditsBridge } = await import(path.join(ROOT, 'api/edits-log.js'));
const { handleReceiptRequest } = await import(path.join(ROOT, 'api/receipt-routes.js'));

function mockRes() {
  return { statusCode: 200, headers: {}, body: '', headersSent: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b || ''; this.headersSent = true; } };
}
async function call(handler, method, url, headers = {}, body = {}) {
  const res = mockRes();
  await handler({ method, url, headers, body, on() {} }, res);
  return res.statusCode;
}
const RANGE = '?from=2026-11-01&to=2026-11-07';
const BRIDGES = [
  [handleBridgeRequest, '/api/bridge/analytics' + RANGE],
  [handleOwnerBridgeRequest, '/api/bridge/owner' + RANGE],
  [handleEditsBridge, '/api/bridge/edits' + RANGE],
];
const RECEIPT_WRITES = ['/api/receipts/redeem', '/api/receipts/complete', '/api/receipts/release'];

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ✔', name); }
  catch (e) { console.log('  ✘', name, '\n     ', e.message); process.exitCode = 1; }
}
console.log('Phase 0.1 — ko\'prik kaliti testlari');

await t('BRIDGE_READ_KEY uchta GET ko\'prigidan o\'tadi (401 emas)', async () => {
  for (const [h, u] of BRIDGES) {
    const st = await call(h, 'GET', u, { 'x-bridge-key': READ });
    assert.ok(st !== 401 && st !== 503, `${u} -> ${st}`);
  }
});

await t('BRIDGE_READ_KEY bilan POST ko\'prikka 405', async () => {
  for (const [h, u] of BRIDGES) assert.equal(await call(h, 'POST', u, { 'x-bridge-key': READ }), 405);
});

await t('BRIDGE_READ_KEY chek endpointlarini OCHMAYDI (redeem/complete/release/verify → 401)', async () => {
  for (const u of RECEIPT_WRITES) {
    assert.equal(await call(handleReceiptRequest, 'POST', u, { 'x-bridge-key': READ }, { code: 'AVS-1' }), 401, u);
    assert.equal(await call(handleReceiptRequest, 'POST', u, { 'x-receipt-key': READ }, { code: 'AVS-1' }), 401, u + ' (X-Receipt-Key)');
  }
  assert.equal(await call(handleReceiptRequest, 'GET', '/api/receipts/verify?code=AVS-1', { 'x-bridge-key': READ }), 401);
  assert.equal(writes.filter(w => /receipts|sessions/i.test(w)).length, 0, 'bazaga yozuv tushmasligi kerak');
});

await t('Eski RECEIPT_SHARED_KEY avvalgidek ishlaydi (ko\'prik va chek tekshiruvi)', async () => {
  for (const [h, u] of BRIDGES) {
    const st = await call(h, 'GET', u, { 'x-receipt-key': SHARED });
    assert.ok(st !== 401 && st !== 503, `${u} -> ${st}`);
  }
  const st = await call(handleReceiptRequest, 'GET', '/api/receipts/verify?code=AVS-1', { 'x-receipt-key': SHARED });
  assert.notEqual(st, 401);
});

await t('Noto\'g\'ri kalit va kalitsiz so\'rov 401', async () => {
  for (const [h, u] of BRIDGES) {
    assert.equal(await call(h, 'GET', u, { 'x-bridge-key': READ + 'x' }), 401);
    assert.equal(await call(h, 'GET', u, {}), 401);
  }
});

await t('32 belgidan qisqa BRIDGE_READ_KEY e\'tiborsiz qoldiriladi', async () => {
  process.env.BRIDGE_READ_KEY = 'short-key';
  assert.equal(await call(handleBridgeRequest, 'GET', BRIDGES[0][1], { 'x-bridge-key': 'short-key' }), 401);
  process.env.BRIDGE_READ_KEY = READ;
});

console.log(`\n${passed} ta test o'tdi${process.exitCode ? ', XATO bor' : ''}.`);
process.exit(process.exitCode || 0);
