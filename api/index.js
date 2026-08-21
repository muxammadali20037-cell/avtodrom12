import app from "../backend/src/server.js";
import { handleFreezeRequest } from "../backend/src/freeze-routes.js";

export default async function handler(req, res) {
  const handled = await handleFreezeRequest(req, res);
  if (handled !== null) return handled;
  return app(req, res);
}
