/* ============================================================================
   KUNLIK ZAXIRA — O'QUVCHILAR FAYLI TELEGRAMGA (20.11.2026)

   Rahbar: «har kuni o'quvchilar ma'lumoti — bazadagi hamma o'quvchi necha
   marta darsga kelgani — Telegram botga tashlab tursin, xavfsizlik uchun;
   faqat o'zimga kelsin».

     • Har kuni 22:00 (Toshkent) — Vercel cron: GET /api/telegram/backup/cron
       (21:00 dan oldin chaqirilsa hech narsa qilmaydi — kun oxiri holati
       ketsin). Cron o'tkazib yuborilsa — kassaning fon so'rovlari 22:30 dan
       keyin o'zi yuboradi (maybeBackupDue).
     • Faqat «Zaxira» yoqilgan SHAXSIY chatlarga (guruhga — yo'q).
       Maxsus → Telegram bot → «Kunlik zaxira» bo'limida yoqiladi.
     • Kuniga bir marta (tg_backups — kim, qaysi kun, yuborildimi).
     • Fayl: Excel — avtoshkola, guruh, F.I.Sh., necha marta kelgan, oxirgi
       kelgan, qo'shilgan sana; 2-varaq — avtoshkolalar bo'yicha jami.
       Telefon va tug'ilgan sana YO'Q (kerak emas, xavfsizroq).

   Excel fayl tashqi kutubxonasiz yasaladi (xlsx = zip ichida XML).
   ========================================================================== */
import zlib from 'node:zlib';
import { pool } from '../backend/src/db.js';
import { runOnce, ddl } from '../backend/src/schema-once.js';
import { ensureTgSchema, tgTokenFor } from './telegram.js';

const TG_BASE = () => String(process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
const tk = d => new Date(new Date(d).getTime() + 5 * 3600e3);
const tkDay = d => tk(d).toISOString().slice(0, 10);
const dmy = d => { if (!d) return ''; const x = tk(d).toISOString(); return x.slice(8, 10) + '.' + x.slice(5, 7) + '.' + x.slice(0, 4); };
const tkHour = () => tk(Date.now()).getUTCHours() + tk(Date.now()).getUTCMinutes() / 60;
const fmt = n => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/* ---------------- sxema ---------------- */
let schemaP = null;
export function ensureBackupSchema() {
  if (schemaP) return schemaP;
  schemaP = ensureTgSchema().then(() => runOnce('telegram-backup-v1', async () => {
    await ddl(`ALTER TABLE tg_chats ADD COLUMN IF NOT EXISTS backup BOOLEAN NOT NULL DEFAULT FALSE`);
    await ddl(`ALTER TABLE tg_chats ADD COLUMN IF NOT EXISTS backup_at TIMESTAMPTZ`);
    await ddl(`ALTER TABLE tg_chats ADD COLUMN IF NOT EXISTS backup_error TEXT`);
    await pool.query(`CREATE TABLE IF NOT EXISTS tg_backups(
      user_id TEXT NOT NULL, day DATE NOT NULL, chat_id BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'sending', tries INTEGER NOT NULL DEFAULT 1,
      rows INTEGER, bytes INTEGER, error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), sent_at TIMESTAMPTZ,
      PRIMARY KEY(user_id, day, chat_id))`);
  })).catch(e => { schemaP = null; throw e; });
  return schemaP;
}

/* ---------------- XLSX (zip + XML) ---------------- */
let CRC = null;
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const comp = zlib.deflateRawSync(raw, { level: 6 });
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, cd, end]);
}
const X = s => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
/* sheet: { name, widths:[...], header:[...], rows:[[...]], bold: Set(rowIndex), filter:true } */
function sheetXml(sh) {
  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
    '<sheetFormatPr defaultRowHeight="15"/><cols>');
  sh.widths.forEach((w, i) => out.push('<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'));
  out.push('</cols><sheetData>');
  const all = [sh.header].concat(sh.rows);
  all.forEach((row, ri) => {
    const style = ri === 0 ? ' s="1"' : (sh.bold && sh.bold.has(ri) ? ' s="2"' : '');
    out.push('<row r="' + (ri + 1) + '">');
    row.forEach((v, ci) => {
      const ref = colName(ci) + (ri + 1);
      if (typeof v === 'number' && Number.isFinite(v)) out.push('<c r="' + ref + '"' + style + '><v>' + v + '</v></c>');
      else if (v !== null && v !== undefined && v !== '') {
        const t = X(v);
        out.push('<c r="' + ref + '"' + style + ' t="inlineStr"><is><t' + (/^\s|\s$/.test(t) ? ' xml:space="preserve"' : '') + '>' + t + '</t></is></c>');
      }
    });
    out.push('</row>');
  });
  out.push('</sheetData>');
  if (sh.filter) out.push('<autoFilter ref="A1:' + colName(sh.header.length - 1) + all.length + '"/>');
  out.push('</worksheet>');
  return out.join('');
}
export function buildXlsx(sheets) {
  const files = [];
  files.push({ name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')
    + '</Types>' });
  files.push({ name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' });
  const defs = sheets.map((s, i) => s.filter
    ? '<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">\'' + X(s.name).replace(/'/g, "''") + '\'!$A$1:$' + colName(s.header.length - 1) + '$' + (s.rows.length + 1) + '</definedName>' : '').join('');
  files.push({ name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheets>' + sheets.map((s, i) => '<sheet name="' + X(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets>'
    + (defs ? '<definedNames>' + defs + '</definedNames>' : '') + '</workbook>' });
  files.push({ name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('')
    + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' });
  files.push({ name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>'
    + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFDCEFE4"/><bgColor indexed="64"/></patternFill></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
    + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' });
  sheets.forEach((s, i) => files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXml(s) }));
  return zip(files);
}

/* ---------------- ma'lumot ---------------- */
const coll = new Intl.Collator('uz', { numeric: true, sensitivity: 'base' });
export async function backupFile(user) {
  const r = await pool.query(`
    SELECT ds.name AS school, g.name AS grp, st.full_name, COALESCE(st.attendance_count, 0)::int AS n,
           st.created_at, la.last_at
      FROM students st
      JOIN driving_schools ds ON ds.id = st.school_id
      LEFT JOIN school_groups g ON g.id = st.group_id
      LEFT JOIN (SELECT student_id::text AS sid, MAX(started_at) AS last_at FROM sessions
                  WHERE user_id = $2 AND status = 'completed' AND student_id IS NOT NULL
                  GROUP BY 1) la ON la.sid = st.id::text
     WHERE st.owner_key = $1 AND st.active = true`, [String(user), String(user)]);
  const rows = r.rows.sort((a, b) => coll.compare(a.school || '', b.school || '') || coll.compare(a.grp || '', b.grp || '') || coll.compare(a.full_name || '', b.full_name || ''));
  const bySchool = new Map();
  let lessons = 0;
  for (const x of rows) {
    lessons += x.n;
    const k = x.school || '—';
    const s = bySchool.get(k) || { groups: new Set(), students: 0, lessons: 0 };
    if (x.grp) s.groups.add(x.grp);
    s.students++; s.lessons += x.n;
    bySchool.set(k, s);
  }
  const groups = Array.from(bySchool.values()).reduce((a, s) => a + s.groups.size, 0);
  const day = tkDay(Date.now());
  const s1 = {
    name: 'O‘quvchilar', filter: true, widths: [7, 28, 12, 42, 14, 14, 14],
    header: ['№', 'Avtoshkola', 'Guruh', 'F.I.Sh.', 'Darsga kelgan', 'Oxirgi kelgan', 'Qo‘shilgan'],
    rows: rows.map((x, i) => [i + 1, x.school || '', /^\d{1,9}$/.test(String(x.grp || '').trim()) ? Number(x.grp) : (x.grp || ''),
      x.full_name || '', x.n, dmy(x.last_at), dmy(x.created_at)])
  };
  const sumRows = Array.from(bySchool.entries()).sort((a, b) => coll.compare(a[0], b[0]))
    .map(([k, s]) => [k, s.groups.size, s.students, s.lessons]);
  sumRows.push(['JAMI', groups, rows.length, lessons]);
  const s2 = { name: 'Jami', widths: [32, 12, 14, 14], header: ['Avtoshkola', 'Guruhlar', 'O‘quvchilar', 'Jami darslar'], rows: sumRows, bold: new Set([sumRows.length]) };
  const buf = buildXlsx([s1, s2]);
  const caption = '📦 <b>Kunlik zaxira</b> · ' + dmy(Date.now()) + '\n'
    + 'O‘quvchilar: <b>' + fmt(rows.length) + '</b> ta · jami darslar: <b>' + fmt(lessons) + '</b>\n'
    + 'Avtoshkolalar: ' + bySchool.size + ' · guruhlar: ' + groups + '\n'
    + '<i>Bu fayl faqat sizga keladi — boshqalarga yubormang.</i>';
  return { buf, caption, rows: rows.length, name: 'avtodrom-oquvchilar-' + day + '.xlsx' };
}

async function sendDocument(token, chatId, file) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const fd = new FormData();
    fd.append('chat_id', String(chatId));
    fd.append('caption', file.caption);
    fd.append('parse_mode', 'HTML');
    fd.append('document', new Blob([file.buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), file.name);
    const r = await fetch(TG_BASE() + '/bot' + token + '/sendDocument', { method: 'POST', body: fd, signal: ctrl.signal });
    const j = await r.json().catch(() => ({ ok: false, error_code: r.status, description: 'Javob o‘qilmadi' }));
    return j;
  } catch (e) {
    return { ok: false, error_code: 0, description: e && e.name === 'AbortError' ? 'Telegram javob bermadi' : String(e && e.message || e) };
  } finally { clearTimeout(timer); }
}

/* Yuborish. force=true — qo'lda («Hozir yuborish»): bugun yuborilgan bo'lsa ham.
   Aks holda har (foydalanuvchi, kun, chat) uchun bir marta. */
export async function runBackups(opts) {
  const o = opts || {};
  await ensureBackupSchema();
  const day = tkDay(Date.now());
  const chats = (await pool.query(`SELECT c.user_id, c.chat_id::text AS chat_id FROM tg_chats c JOIN tg_bots b ON b.user_id = c.user_id
     WHERE c.backup AND c.kind = 'private'` + (o.user ? ` AND c.user_id = $1` : ''), o.user ? [String(o.user)] : [])).rows;
  const files = new Map();
  const result = { day, chats: chats.length, sent: 0, skipped: 0, errors: [] };
  for (const c of chats) {
    if (!o.force) {
      const claim = await pool.query(`INSERT INTO tg_backups(user_id, day, chat_id) VALUES($1, $2::date, $3::bigint)
        ON CONFLICT (user_id, day, chat_id) DO UPDATE SET status = 'sending', tries = tg_backups.tries + 1, created_at = now(), error = NULL
          WHERE (tg_backups.status = 'failed' AND tg_backups.tries < 4)
             OR (tg_backups.status = 'sending' AND tg_backups.created_at < now() - interval '10 minutes')
        RETURNING tries`, [c.user_id, day, c.chat_id]);
      if (!claim.rowCount) { result.skipped++; continue; }
    }
    try {
      const token = await tgTokenFor(c.user_id);
      if (!token) throw new Error('bot ulanmagan');
      if (!files.has(c.user_id)) files.set(c.user_id, await backupFile(c.user_id));
      const f = files.get(c.user_id);
      const j = await sendDocument(token, c.chat_id, f);
      if (!j.ok) throw new Error(j.description || ('Telegram xatosi ' + (j.error_code || '')));
      await pool.query(`UPDATE tg_chats SET backup_at = now(), backup_error = NULL WHERE user_id = $1 AND chat_id = $2::bigint`, [c.user_id, c.chat_id]);
      /* Qo'lda («Hozir yuborish») yuborilgani kunlik hisobga kirmaydi —
         kechki 22:00 dagisi baribir ketadi (kun oxiri holati bilan). */
      if (!o.force) await pool.query(`INSERT INTO tg_backups(user_id, day, chat_id, status, rows, bytes, sent_at) VALUES($1, $2::date, $3::bigint, 'sent', $4, $5, now())
        ON CONFLICT (user_id, day, chat_id) DO UPDATE SET status = 'sent', rows = EXCLUDED.rows, bytes = EXCLUDED.bytes, sent_at = now(), error = NULL`,
        [c.user_id, day, c.chat_id, f.rows, f.buf.length]);
      result.sent++;
    } catch (e) {
      const msg = String(e && e.message || e).slice(0, 300);
      result.errors.push(msg);
      console.error('TG BACKUP:', c.user_id, c.chat_id, msg);
      await pool.query(`UPDATE tg_chats SET backup_error = $3 WHERE user_id = $1 AND chat_id = $2::bigint`, [c.user_id, c.chat_id, msg]).catch(() => {});
      if (!o.force) await pool.query(`INSERT INTO tg_backups(user_id, day, chat_id, status, error) VALUES($1, $2::date, $3::bigint, 'failed', $4)
        ON CONFLICT (user_id, day, chat_id) DO UPDATE SET status = CASE WHEN tg_backups.status = 'sent' THEN 'sent' ELSE 'failed' END, error = EXCLUDED.error`,
        [c.user_id, day, c.chat_id, msg]).catch(() => {});
    }
  }
  return result;
}

/* Cron o'tkazib yuborilsa: kassaning fon so'rovlarida 22:30 dan keyin
   (10 daqiqada bir tekshiradi) — bugungisi yuborilmagan bo'lsa yuboriladi. */
let dueAt = 0;
export async function maybeBackupDue() {
  try {
    if (Date.now() - dueAt < 600000) return;
    if (tkHour() < 22.5) return;
    dueAt = Date.now();
    await ensureBackupSchema();
    const day = tkDay(Date.now());
    const due = await pool.query(`SELECT 1 FROM tg_chats c WHERE c.backup AND c.kind = 'private'
      AND NOT EXISTS (SELECT 1 FROM tg_backups k WHERE k.user_id = c.user_id AND k.chat_id = c.chat_id AND k.day = $1::date
                      AND (k.status = 'sent' OR (k.status = 'failed' AND k.tries >= 4))) LIMIT 1`, [day]);
    if (due.rowCount) await runBackups({});
  } catch (e) { console.error('TG BACKUP DUE:', e.message); }
}

/* Cron: GET /api/telegram/backup/cron — kechqurun (21:00 dan keyin) ishlaydi.
   Ochiq manzil, lekin kuniga bir martadan ortiq yubormaydi va faqat
   egasining o'z chatiga yuboradi. */
export async function backupCron(req, res) {
  const sec = process.env.CRON_SECRET;
  if (sec && String((req.headers || {}).authorization || '') !== 'Bearer ' + sec) {
    res.statusCode = 401; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false })); return;
  }
  const h = tkHour();
  if (h < 21) { res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, skipped: 'vaqti emas' })); return; }
  const r = await runBackups({});
  console.log('TG BACKUP CRON', JSON.stringify(r));
  res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ ok: true, day: r.day, chats: r.chats, sent: r.sent, skipped: r.skipped, errors: r.errors.length }));
}
