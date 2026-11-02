import app from "../backend/src/server.js";
import { handleFreezeRequest } from "../backend/src/freeze-routes.js";
import { handleCompatRequest } from "./compat-routes.js";
import { handleV3Request } from "./v3-routes.js";
import { handleAdminRequest } from "./admin-auth-v2.js";
import { handleReceiptRequest } from "./receipt-routes.js";
import { handleControlRequest } from "./control-routes.js";
import { handleFleetRequest } from "./fleet-routes.js";
import { handleQuotaRequest, ensureQuotaSchema } from "./quota-routes.js";
import { ensureDbSafety } from "../backend/src/schema-once.js";
import { handleSheetRequest } from "./sheet-routes.js";
import { handleLockRequest } from "./lock-routes.js";
import { handleAuditRequest } from "./audit-routes.js";
import { handleGateRequest } from "./gate-routes.js";
import { handleAccessRequest, ensureAccessSchema } from "./access-routes.js";
import { handleKassaRequest, ensureKassaSchema, sweepForRequest } from "./kassa-routes.js";
import { handleQueueRequest } from "./queue-routes.js";
import { handleBridgeRequest } from "./bridge-analytics.js";
import { handleOwnerBridgeRequest } from "./bridge-owner.js";
import instructorHandler from "./instructor.js";
import instructorsFixed from "./instructors-fixed.js";
import instructorDailyHandler from "./instructor-daily.js";
import { readFile } from "node:fs/promises";
import { opGuard } from "./op-guard.js";
import { SW_SOURCE } from "./sw-source.js";
import { handleTelegramRequest, tgFlushIfAny } from "./telegram.js";
import { handleCleanupRequest, cleanupAllOnce } from "./cleanup-routes.js";
import { handleEntryRequest, guardAuth } from "./entry-routes.js";
import { handleAccountsRequest, trackActivity, isDeletedAccount } from "./accounts-routes.js";

const rootFrontend = new URL("../index.html", import.meta.url);
const backupFrontend = new URL("../index.backup.html", import.meta.url);
const instructorFrontend = new URL("../instructor.html", import.meta.url);
const gateFrontend = new URL("../turniket.html", import.meta.url);
const screenFrontend = new URL("../ekran.html", import.meta.url);

export default async function handler(req, res) {
  const path = String(req.url || "").split("?",1)[0];

  /* INTERNETSIZ REJIM: sahifa va kutubxonalarni kompyuterda saqlovchi skript */
  if (path === "/sw.js" && req.method === "GET") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Service-Worker-Allowed", "/");
    return res.end(SW_SOURCE);
  }

  /* Shartnoma limiti ustunlari (driving_schools.free_visits va h.k.)
     birinchi so'rovda qo'shiladi. Natija keshlanadi, shuning uchun
     keyingi so'rovlarga qo'shimcha yuk bo'lmaydi. Bu yerda turgani
     muhim: limitni saqlash boshqa fayldan (admin) chaqirilsa ham,
     ro'yxatni o'qish esa Express'dan kelsa ham ustun mavjud bo'ladi. */
  if (path.startsWith("/api/")) { try { await ensureDbSafety(); } catch (e) { /* noop */ } }
  if (path.startsWith("/api/")) { try { await ensureQuotaSchema(); } catch (e) { /* noop */ } }
  /* Kirish muddati ustunlari — har qanday tranzaksiyadan OLDIN (ichida DDL qotib qoladi) */
  if (path.startsWith("/api/")) { try { await ensureAccessSchema(); } catch (e) { /* noop */ } }
  /* Klik ustuni, erkin yozuvli avtomobil, xarajatlar jadvali — ham tranzaksiyadan oldin */
  if (path.startsWith("/api/")) { try { await ensureKassaSchema(); } catch (e) { console.error("KASSA SCHEMA:", e.message); } }
  /* Bir martalik (rahbar so'rovi, 01.11.2026): jarayonda qolib ketganlar yopiladi */
  if (path.startsWith("/api/")) { try { await cleanupAllOnce(); } catch (e) { console.error("CLEANUP ONCE:", e.message); } }
  /* O'chirilgan hisobning kaliti darhol yaroqsiz — o'sha kompyuter tizimdan chiqadi */
  if (path.startsWith("/api/") && req.headers.authorization && await isDeletedAccount(req)) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ error: "Bu hisob o‘chirilgan", deleted: true }));
  }
  /* Vaqti tugagan «1 soatga» kabi yozuvlar faol ro'yxat / hisobotdan oldin yopiladi */
  try { await sweepForRequest(req); } catch (e) { console.error("AUTO CLOSE:", e.message); }

  /* BIR AMAL — BIR MARTA: internetsiz yozilib keyin yuborilgan (yoki ikki
     marta yetib kelgan) «Kirdi/Chiqdi/To'lash/davomat» qayta bajarilmaydi */
  if (path.startsWith("/api/") && req.headers["x-op-id"]) {
    try { if (await opGuard(req, res)) return; } catch (e) { console.error("OP GUARD:", e.message); }
  }

  /* Hisob + kompyuter faolligi (kim hozir kirgan) — bir daqiqada bir marta */
  if (path.startsWith("/api/") && req.headers.authorization) trackActivity(req).catch(() => {});
  if (path.startsWith("/api/accounts/")) { const acHandled = await handleAccountsRequest(req, res); if (acHandled) return acHandled; }

  /* KIRISH KODI (1212) — login/ro'yxatdan o'tish shu kodsiz ishlamaydi */
  if (path.startsWith("/api/entry/")) { const enHandled = await handleEntryRequest(req, res); if (enHandled) return enHandled; }
  if (guardAuth(req, res)) return;
  /* JARAYONDAGILARNI TOZALASH (Maxsus bo'lim) */
  if (path.startsWith("/api/cleanup/")) { const clHandled = await handleCleanupRequest(req, res); if (clHandled) return clHandled; }

  /* TELEGRAM BOT — webhook (Telegram'dan) va sozlash (Maxsus bo'lim) */
  if (path.startsWith("/api/telegram/")) { const tgHandled = await handleTelegramRequest(req, res); if (tgHandled) return tgHandled; }
  /* Navbatdagi Telegram xabarlari kassaning fon so'rovlarida yuboriladi
     (bot ulanmagan bo'lsa — hech narsa qilmaydi) */
  if (req.method === "GET" && (path === "/api/sessions/active" || path === "/api/queue" || path === "/api/debts")) {
    await tgFlushIfAny(1500);
  }

  /* ANALITIKA KO'PRIGI — Avtodrom admin «Analitika» sahifasi uchun
     (faqat o'qiydi; kalit: RECEIPT_SHARED_KEY, QR chek ko'prigi bilan bir xil) */
  if (path === "/api/bridge/analytics") return handleBridgeRequest(req, res);
  /* BOSHLIQ KO'PRIGI — Avtodrom «Boshliq ilovasi» (iPhone): avtoshkola,
     platniy (oddiy mijoz), xarajatlar. Faqat o'qiydi, kalit o'sha. */
  if (path === "/api/bridge/owner") return handleOwnerBridgeRequest(req, res);

  /* Telegram instruktor mini-ilovasi — FAQAT birlikdagi /api/instructor/...
     Ilgari bu shart `startsWith("/api/instructor")` edi va ko'plikdagi
     `/api/instructors` ni ham yutib yuborardi: Vercel'da uni vercel.json
     alohida yo'naltirgani uchun sezilmasdi, lekin boshqa o'rnatmada
     instruktorlar ro'yxati «route topilmadi» bo'lib qolardi. */
  if (path === "/api/instructor" || path.startsWith("/api/instructor/")) {
    return instructorHandler(req, res);
  }

  /* Instruktorlar API — vercel.json dagi yo'nalish bilan bir xil,
     shunda Vercel'dan tashqarida ham xuddi shunday ishlaydi. */
  const instDaily = path.match(/^\/api\/instructors\/([^/]+)\/daily$/);
  if (instDaily) {
    req.query = Object.assign({}, req.query, { id: decodeURIComponent(instDaily[1]) });
    return instructorDailyHandler(req, res);
  }
  const instOne = path.match(/^\/api\/instructors\/([^/]+)$/);
  if (instOne) {
    req.query = Object.assign({}, req.query, { id: decodeURIComponent(instOne[1]) });
    return instructorsFixed(req, res);
  }
  if (path === "/api/instructors") return instructorsFixed(req, res);

  const jsonRes = {
    status(code) { res.statusCode = code; return this; },
    json(data) { if (!res.headersSent) res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(data)); return this; }
  };

  /* QR chek (avtoshkola). Avtodrom instruktor paneli ham shu yerga
     murojaat qiladi — /api/receipts/verify|redeem|complete. */
  const receiptHandled = await handleReceiptRequest(req, res); if (receiptHandled) return receiptHandled;

  /* MAXSUS BO'LIM — parol bilan qulf */
  const lockHandled = await handleLockRequest(req, res); if (lockHandled) return lockHandled;

  /* EXCEL bo'limi — butun ekran jadval, Ctrl+S bilan saqlash */
  const sheetHandled = await handleSheetRequest(req, res); if (sheetHandled) return sheetHandled;

  /* RASXOD — xarajatlar */
  const kassaHandled = await handleKassaRequest(req, res); if (kassaHandled) return kassaHandled;
  const queueHandled = await handleQueueRequest(req, res); if (queueHandled) return queueHandled;

  /* KIRISH MUDDATI — guruh muddati va shaxsiy muhlat */
  const accessHandled = await handleAccessRequest(req, res); if (accessHandled) return accessHandled;

  /* TURNIKET — chekdagi QR bilan kirish/chiqish */
  const gateHandled = await handleGateRequest(req, res); if (gateHandled) return gateHandled;

  /* AVTOSHKOLA MASHINALARI */
  const fleetHandled = await handleFleetRequest(req, res); if (fleetHandled) return fleetHandled;

  /* SHARTNOMA LIMITI — bepul kirishlar */
  const quotaHandled = await handleQuotaRequest(req, res); if (quotaHandled) return quotaHandled;

  /* O'ZGARTIRISHLAR JURNALI */
  const auditHandled = await handleAuditRequest(req, res); if (auditHandled) return auditHandled;

  /* NAZORAT — «Xatoliklar va aniqliklar» */
  const controlHandled = await handleControlRequest(req, res); if (controlHandled) return controlHandled;

  const adminHandled = await handleAdminRequest(req, res); if (adminHandled) return adminHandled;
  const v3Handled = await handleV3Request(req, res); if (v3Handled) return v3Handled;
  const compatHandled = await handleCompatRequest(req, res); if (compatHandled) return compatHandled;
  const handled = await handleFreezeRequest(req, jsonRes); if (handled !== null) return handled;

  if (req.method === "GET" && !path.startsWith("/api/")) {
    try {
      const filePath = path === "/index.backup.html" ? backupFrontend
        : path === "/instructor.html" || path === "/instructor" ? instructorFrontend
        : path === "/turniket.html" || path === "/turniket" ? gateFrontend
        : path === "/ekran.html" || path === "/ekran" ? screenFrontend
        : rootFrontend;
      const html = await readFile(filePath, "utf8");
      res.statusCode=200; res.setHeader("Content-Type","text/html; charset=utf-8"); res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate"); res.setHeader("Pragma","no-cache"); res.setHeader("Expires","0");
      return res.end(html);
    } catch(error) { console.error("FRONTEND SERVE ERROR:",error?.message||error); res.statusCode=500; res.setHeader("Content-Type","application/json; charset=utf-8"); return res.end(JSON.stringify({error:"Frontend yuklanmadi"})); }
  }
  return app(req,res);
}
