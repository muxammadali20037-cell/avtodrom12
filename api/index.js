import app from "../backend/src/server.js";
import { handleFreezeRequest } from "../backend/src/freeze-routes.js";
import { handleCompatRequest } from "./compat-routes.js";
import { handleV3Request } from "./v3-routes.js";
import { handleAdminRequest } from "./admin-auth-v2.js";
import { handleReceiptRequest } from "./receipt-routes.js";
import { handleControlRequest } from "./control-routes.js";
import { handleFleetRequest } from "./fleet-routes.js";
import { handleQuotaRequest, ensureQuotaSchema } from "./quota-routes.js";
import { handleAuditRequest } from "./audit-routes.js";
import { handleGateRequest } from "./gate-routes.js";
import instructorHandler from "./instructor.js";
import instructorsFixed from "./instructors-fixed.js";
import instructorDailyHandler from "./instructor-daily.js";
import { readFile } from "node:fs/promises";

const rootFrontend = new URL("../index.html", import.meta.url);
const backupFrontend = new URL("../index.backup.html", import.meta.url);
const instructorFrontend = new URL("../instructor.html", import.meta.url);
const gateFrontend = new URL("../turniket.html", import.meta.url);

export default async function handler(req, res) {
  const path = String(req.url || "").split("?",1)[0];

  /* Shartnoma limiti ustunlari (driving_schools.free_visits va h.k.)
     birinchi so'rovda qo'shiladi. Natija keshlanadi, shuning uchun
     keyingi so'rovlarga qo'shimcha yuk bo'lmaydi. Bu yerda turgani
     muhim: limitni saqlash boshqa fayldan (admin) chaqirilsa ham,
     ro'yxatni o'qish esa Express'dan kelsa ham ustun mavjud bo'ladi. */
  if (path.startsWith("/api/")) { try { await ensureQuotaSchema(); } catch (e) { /* noop */ } }

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
        : rootFrontend;
      const html = await readFile(filePath, "utf8");
      res.statusCode=200; res.setHeader("Content-Type","text/html; charset=utf-8"); res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate"); res.setHeader("Pragma","no-cache"); res.setHeader("Expires","0");
      return res.end(html);
    } catch(error) { console.error("FRONTEND SERVE ERROR:",error?.message||error); res.statusCode=500; res.setHeader("Content-Type","application/json; charset=utf-8"); return res.end(JSON.stringify({error:"Frontend yuklanmadi"})); }
  }
  return app(req,res);
}
