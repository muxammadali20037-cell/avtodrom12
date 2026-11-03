/* ============================================================================
   AI YORDAMCHI — dasturni o'rgatadi (qayerda nima, kim nima qiladi, qanday)

   Asosiy ish sahifaning o'zida: bilim bazasi (api/assistant-kb.js) sahifa
   bilan birga keladi va internetsiz ham javob beradi. Server faqat:

     GET  /api/assistant/config   { ai, admin_name, admin_phone }
     POST /api/assistant/config   { admin_name, admin_phone }   (Maxsus)
     POST /api/assistant/ask      { q, history }  — ANTHROPIC_API_KEY
          o'rnatilgan bo'lsa haqiqiy AI javobi (Claude). Kalit bo'lmasa 501.

   QOIDA: yordamchi HECH QANDAY ma'lumot bermaydi (pul, hisobot raqamlari,
   mijozlar, mashina tarixi, telefon, parol, kod). Bunday savolga —
   «Adminga qo'ng'iroq qiling». Server bazadagi ma'lumotni AI ga umuman
   bermaydi; savol oldin isDataQuestion bilan tekshiriladi.
   ========================================================================== */

import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';
import { runOnce } from '../backend/src/schema-once.js';
import { maxsusOk, lockedResponse } from './lock-routes.js';
import { KB } from './assistant-kb.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';

function json(res, status, data) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}
function userOf(req) {
  try {
    const h = req.headers?.authorization || '';
    if (!h.startsWith('Bearer ')) return null;
    const p = jwt.verify(h.slice(7), JWT_SECRET);
    return p && p.sub && String(p.sub) !== 'admin' ? { sub: String(p.sub), act: String(p.act || p.sub) } : null;
  } catch { return null; }
}
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return await new Promise(resolve => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 4e4) req.destroy(); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

let schemaP = null;
function ensureSchema() {
  if (schemaP) return schemaP;
  schemaP = runOnce('app-settings-v1', async () => {
    await pool.query(`CREATE TABLE IF NOT EXISTS app_settings(
      key TEXT PRIMARY KEY, value JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  }).catch(e => { schemaP = null; throw e; });
  return schemaP;
}
async function readConfig() {
  await ensureSchema();
  const r = await pool.query(`SELECT value FROM app_settings WHERE key = 'assistant'`);
  const v = (r.rows[0] && r.rows[0].value) || {};
  return { admin_name: String(v.admin_name || ''), admin_phone: String(v.admin_phone || '') };
}

/* ---------- MA'LUMOT SO'RALYAPTIMI (sahifadagi bilan bir xil qoida) ---------- */
export function normalizeQ(s) {
  return String(s || '').toLowerCase()
    .replace(/[ʻʼ’‘`´']/g, '')
    .replace(/o‘|o'/g, 'o').replace(/g‘|g'/g, 'g')
    .replace(/moshin/g, 'mashin').replace(/jaroyon/g, 'jarayon').replace(/qanaqa|qanqa/g, 'qanday')
    .replace(/[^a-z0-9а-яёўқғҳ\s-]/gi, ' ').replace(/\s+/g, ' ').trim();
}
export function isDataQuestion(raw) {
  const q = ' ' + normalizeQ(raw) + ' ';
  const howTo = /\b(qanday|qayerda|qayerga|qayerdan|qilinadi|qilaman|qilamiz|qilish|qoyiladi|qoyaman|qoyish|ozgartir|almashtir|tiklay|tiklash|unutdim|unutsam|unutib|organ|tushuntir|ochiladi|ochaman|kiritiladi|kiritaman|bosaman|bosiladi|ishlaydi|nima qilsam|nima qilay)/.test(q);
  /* parol / kod / login qiymati */
  if (/\b(parol|parolni|paroli|kod|kodi|kodni|pin|login|logini|kalit)\b/.test(q)
      && /\b(ayt|aytib|aytin|aytchi|ber|bering|nima|nechi|nechchi|yoz|yozib|korsat|bilasan|bilasizmi|qanday)\b/.test(q)
      && !/\b(qoyiladi|qoyaman|qoyish|ozgartir|almashtir|tiklay|tiklash|unutdim|unutsam|unutib|kiritiladi|kiritaman|qayerga|qayerda|ochiladi|ochaman|nega|nimaga)\w*/.test(q)) return true;
  /* telefon / nomer */
  if (/\b(telefon|telefoni|tel|nomer|nomeri)\b/.test(q) && !/\b(admin)/.test(q)) return true;
  /* «ma'lumot ber» */
  if (/\bmalumot(ni|lar|larni)? (ber|bering|chiqar|korsat|ayt)/.test(q)) return true;
  /* pul / tushum / qancha */
  const price = /\b(narx|narxi|turadi|necha pul|soat|soati|daqiqa|daq|minut|30|40)\b/.test(q);
  if (/\bqancha\b/.test(q) && !price && /\b(pul|tushum|summa|ishlad|topd|tushd|qarz|xarajat|rasxod|kassa|qoldi|bor|toladi|tolandi|oldi|olindi|kirim|foyda|daromad|naqd|terminal|klik|click)/.test(q)) return true;
  if (/\b(tushum|daromad|foyda|kassada|kassa qoldi|jami pul|kirim)\b/.test(q) && !howTo) return true;
  /* nechta mashina / mijoz */
  if (/\b(nechta|necha|qancha)\b/.test(q) && /\b(mashina|mijoz|odam|kirdi|keldi|kelgan|kirgan|yozuv|qarzdor|ochildi|ochgan|chiqdi|oquvchi)/.test(q) && !price) return true;
  /* kim qarzdor / kim kelgan */
  if (/\bkim(lar)?\b/.test(q) && /\b(qarzdor|tolamagan|tolagan|kelgan|kirgan|ochgan|olgan|ishlagan|yozgan|kirdi|keldi)\b/.test(q)) return true;
  if (/\bqarzdorlar?\b/.test(q) && !howTo) return true;
  /* hisobot raqamlari */
  if (/\b(hisobot|hisobotni|otchet)\w*/.test(q) && /\b(ber|bering|korsat|ayt|chiqar|qancha|nechta|yubor)\w*/.test(q) && !howTo) return true;
  /* aniq raqam (mashina) haqida: «566 qachon kelgan», «402 qarzi bormi» */
  const nums = (q.match(/\b\d{2,}\b/g) || []).filter(n => !/^(30|40|50|60|90|100|120|150|200|1000|50000|100000|150000)$/.test(n));
  if (nums.length && !/\b\d+\s*(daq|daqiqa|minut|soat|som|ming|post|-post)\b/.test(q) && !howTo) return true;
  return false;
}
export function adminMessage(cfg) {
  const who = cfg && (cfg.admin_name || cfg.admin_phone)
    ? '\n📞 Admin: ' + [cfg.admin_name, cfg.admin_phone].filter(Boolean).join(' — ') : '';
  return 'Bu ma\'lumotni men bera olmayman — men faqat dasturdan qanday foydalanishni o\'rgataman. Bu ma\'lumot uchun Adminga qo\'ng\'iroq qiling.' + who;
}

/* ---------- HAQIQIY AI (ixtiyoriy) ---------- */
function kbText() {
  return KB.map(a => '### ' + a.title + (a.where ? ' (' + a.where + ')' : '') + (a.who ? ' — ' + a.who : '') + '\n'
    + (a.text || '') + (a.steps && a.steps.length ? '\n' + a.steps.map((s, i) => (i + 1) + ') ' + s).join('\n') : '')
    + (a.tips && a.tips.length ? '\nMaslahat: ' + a.tips.join(' | ') : '')).join('\n\n');
}
let SYSTEM = null;
function systemPrompt() {
  if (SYSTEM) return SYSTEM;
  SYSTEM = 'Sen «Avtodrom 12» kassa dasturining yordamchisisan (AI yordamchi). Faqat o‘zbek tilida (lotin yozuvi), qisqa va oddiy so‘zlar bilan javob ber — foydalanuvchilar kassirlar va rahbar, texnik emas.\n'
    + 'Vazifang: dasturdan qanday foydalanishni o‘rgatish va tushuntirish — qaysi bo‘limda nima qilinadi, qaysi tugma bosiladi, kim (kassir yoki rahbar) nima qiladi, muammo bo‘lsa nima qilish kerak.\n'
    + 'QOIDALAR:\n'
    + '1) Faqat quyidagi BILIMLARga tayan. Bilimlarda yo‘q narsani o‘ylab topma; bilmasang: «Buni aniq bilmayman — Adminga qo‘ng‘iroq qiling.»\n'
    + '2) HECH QACHON ma’lumot berma va taxmin qilma: pul summalari, tushum, hisobot raqamlari, qancha mashina kelgani, mijozlar, mashina raqamlari tarixi, qarzdorlar, telefonlar, parollar, kirish kodi, loginlar. Bunday so‘rovga faqat: «Bu ma’lumot uchun Adminga qo‘ng‘iroq qiling.» Senda bazaga kirish yo‘q.\n'
    + '3) Narx qoidalarini (30 daqiqa 50 000, 1 soat 100 000 va h.k.) aytish mumkin — bu ma’lumot emas, qoida.\n'
    + '4) Tugma va bo‘lim nomlarini «» ichida yoz. Qadamlar bo‘lsa raqamla. Javob 10 qatordan oshmasin.\n'
    + '5) Dasturga aloqasi yo‘q savolga: «Men faqat Avtodrom dasturi bo‘yicha yordam beraman.»\n\n'
    + 'BILIMLAR:\n' + kbText();
  return SYSTEM;
}

const rate = new Map();      // login -> [vaqtlar]
function rateOk(user) {
  const now = Date.now();
  const a = (rate.get(user) || []).filter(t => now - t < 3600e3);
  if (a.length >= 60) { rate.set(user, a); return false; }
  a.push(now); rate.set(user, a);
  if (rate.size > 2000) rate.clear();
  return true;
}

async function ask(req, res, u) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json(res, 501, { error: 'AI ulanmagan', ai: false });
  const b = await readBody(req);
  const q = String(b.q || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (!q) return json(res, 400, { error: 'Savol yozing' });
  const cfg = await readConfig().catch(() => ({}));
  if (isDataQuestion(q)) return json(res, 200, { answer: adminMessage(cfg), data: true });
  if (!rateOk(u.act)) return json(res, 429, { error: 'Juda ko‘p savol — birozdan keyin urinib ko‘ring' });
  const hist = (Array.isArray(b.history) ? b.history : []).slice(-6)
    .map(m => ({ role: m && m.role === 'assistant' ? 'assistant' : 'user', content: String((m && m.text) || '').slice(0, 1500) }))
    .filter(m => m.content);
  /* ketma-ketlik user/assistant almashib kelsin, oxiri — yangi savol */
  const msgs = [];
  for (const m of hist) { if (msgs.length && msgs[msgs.length - 1].role === m.role) msgs[msgs.length - 1].content += '\n' + m.content; else msgs.push(m); }
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  if (msgs.length && msgs[msgs.length - 1].role === 'user') msgs.pop();
  msgs.push({ role: 'user', content: q });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch((process.env.ANTHROPIC_API_BASE || 'https://api.anthropic.com') + '/v1/messages', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ASSISTANT_MODEL || 'claude-sonnet-5',
        max_tokens: 800,
        system: [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }],
        messages: msgs
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { console.error('ASSISTANT AI:', r.status, j && j.error && j.error.message); return json(res, 502, { error: 'AI javob bermadi' }); }
    let text = (j.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n').trim();
    if (!text) return json(res, 502, { error: 'AI javob bermadi' });
    /* «Adminga» degan javobga admin raqami qo'shiladi */
    if (/adminga qo.?ng.?iroq/i.test(text) && (cfg.admin_name || cfg.admin_phone)) text += '\n📞 Admin: ' + [cfg.admin_name, cfg.admin_phone].filter(Boolean).join(' — ');
    json(res, 200, { answer: text, ai: true });
  } catch (e) {
    json(res, 502, { error: e && e.name === 'AbortError' ? 'AI javob bermadi (vaqt tugadi)' : 'AI bilan aloqa yo‘q' });
  } finally { clearTimeout(timer); }
}

export async function handleAssistantRequest(req, res) {
  const path = String(req.url || '').split('?', 1)[0];
  if (!path.startsWith('/api/assistant/')) return false;
  const u = userOf(req);
  if (!u) { json(res, 401, { error: 'Kirish talab qilinadi' }); return true; }
  try {
    if (path === '/api/assistant/config' && req.method === 'GET') {
      const cfg = await readConfig();
      json(res, 200, Object.assign({ ai: !!process.env.ANTHROPIC_API_KEY }, cfg));
      return true;
    }
    if (path === '/api/assistant/config' && req.method === 'POST') {
      if (!maxsusOk(req, u.sub)) { lockedResponse(res); return true; }
      const b = await readBody(req);
      const v = {
        admin_name: String(b.admin_name || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        admin_phone: String(b.admin_phone || '').replace(/[^\d+()\s-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30)
      };
      await ensureSchema();
      await pool.query(`INSERT INTO app_settings(key, value) VALUES('assistant', $1)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(v)]);
      json(res, 200, Object.assign({ ok: true, ai: !!process.env.ANTHROPIC_API_KEY }, v));
      return true;
    }
    if (path === '/api/assistant/ask' && req.method === 'POST') { await ask(req, res, u); return true; }
    json(res, 404, { error: 'Topilmadi' });
    return true;
  } catch (e) {
    console.error('ASSISTANT ERROR:', e);
    json(res, 500, { error: e.message || 'Xatolik' });
    return true;
  }
}
