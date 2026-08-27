import app from "../backend/src/server.js";
import { handleFreezeRequest } from "../backend/src/freeze-routes.js";
import { handleCompatRequest } from "./compat-routes.js";
import { handleV3Request } from "./v3-routes.js";
import { handleAdminRequest } from "./admin-auth-v2.js";
import { readFile } from "node:fs/promises";

const rootFrontend = new URL("../index.html", import.meta.url);
const backupFrontend = new URL("../index.backup.html", import.meta.url);

export default async function handler(req, res) {
  const jsonRes = {
    status(code) { res.statusCode = code; return this; },
    json(data) {
      if (!res.headersSent) res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(data));
      return this;
    }
  };

  const adminHandled = await handleAdminRequest(req, res);
  if (adminHandled) return adminHandled;

  const v3Handled = await handleV3Request(req, res);
  if (v3Handled) return v3Handled;

  const compatHandled = await handleCompatRequest(req, res);
  if (compatHandled) return compatHandled;

  const handled = await handleFreezeRequest(req, jsonRes);
  if (handled !== null) return handled;

  if (req.method === "GET" && !String(req.url || "").startsWith("/api/")) {
    try {
      const requested = String(req.url || "").split("?", 1)[0];
      const filePath = requested === "/index.backup.html" ? backupFrontend : rootFrontend;
      const html = await readFile(filePath, "utf8");

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader("X-Avtodrom-Frontend", requested === "/index.backup.html" ? "backup-entrypoint" : "root-entrypoint");
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
