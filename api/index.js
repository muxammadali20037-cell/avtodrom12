import app from "../backend/src/server.js";
import { handleFreezeRequest } from "../backend/src/freeze-routes.js";
import { handleCompatRequest } from "./compat-routes.js";
import { handleV3Request } from "./v3-routes.js";
import { readFile } from "node:fs/promises";

export default async function handler(req, res) {
  const jsonRes = {
    status(code) { res.statusCode = code; return this; },
    json(data) {
      if (!res.headersSent) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
      }
      res.end(JSON.stringify(data));
      return this;
    }
  };

  // V3 BIRINCHI: yetishmayotgan endpointlar (students PUT/DELETE, instructors,
  // sessions/active-v3, start-v3, vehicle-lookup, student-history).
  // Faqat o'ziga tegishli yo'llarni ushlaydi, qolganini o'tkazib yuboradi.
  const v3Handled = await handleV3Request(req, res);
  if (v3Handled) return v3Handled;

  const compatHandled = await handleCompatRequest(req, res);
  if (compatHandled) return compatHandled;

  const handled = await handleFreezeRequest(req, jsonRes);
  if (handled !== null) return handled;

  // IMPORTANT: never inject repair/restore scripts into the production HTML.
  // The main frontend/index.html is already the canonical application file.
  if (req.method === "GET" && !String(req.url || "").startsWith("/api/") && req.url !== "/favicon.ico") {
    const filePath = new URL("../frontend/index.html", import.meta.url);
    try {
      const html = await readFile(filePath, "utf8");
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      return res.end(html);
    } catch (error) {
      console.error("FRONTEND SERVE ERROR:", error?.message || error);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ error: "Frontend yuklanmadi" }));
    }
  }

  return app(req, res);
}
