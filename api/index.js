import app from "../backend/src/server.js";
import { handleFreezeRequest } from "../backend/src/freeze-routes.js";

export default async function handler(req, res) {
  const jsonRes = {
    status(code) {
      res.statusCode = code;
      return this;
    },
    json(data) {
      if (!res.headersSent) res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(data));
      return this;
    }
  };

  const handled = await handleFreezeRequest(req, jsonRes);
  if (handled !== null) return handled;
  return app(req, res);
}
