import app from "../backend/src/server.js";
import { handleFreezeRequest } from "../backend/src/freeze-routes.js";
import { handleCompatRequest } from "./compat-routes.js";
import { handleV3Request } from "./v3-routes.js";
import { readFile } from "node:fs/promises";

const frontendFile = new URL("../frontend/index.html", import.meta.url);
const relationsFile = new URL("../frontend/relations-v4.js", import.meta.url);

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

  // V3 BIRINCHI: yetishmayotgan endpointlar.
  const v3Handled = await handleV3Request(req, res);
  if (v3Handled) return v3Handled;

  const compatHandled = await handleCompatRequest(req, res);
  if (compatHandled) return compatHandled;

  const handled = await handleFreezeRequest(req, jsonRes);
  if (handled !== null) return handled;

  // Canonical frontend: serve the existing index.html and add ONLY the
  // requested student/instructor relation layer. No HTML repair/rewriting.
  if (req.method === "GET" && !String(req.url || "").startsWith("/api/") && req.url !== "/favicon.ico") {
    try {
      const [html, relations] = await Promise.all([
        readFile(frontendFile, "utf8"),
        readFile(relationsFile, "utf8")
      ]);

      const relationScript = '<script id="avtodrom-relations-v4">\n' + relations + '\n</script>';
      const out = html.includes('id="avtodrom-relations-v4"')
        ? html
        : html.replace("</body>", relationScript + "</body>");

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader("X-Avtodrom-Frontend", "canonical-relations-v4");
      return res.end(out);
    } catch (error) {
      console.error("FRONTEND SERVE ERROR:", error?.message || error);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ error: "Frontend yuklanmadi" }));
    }
  }

  return app(req, res);
}