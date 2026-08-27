import { handleV3Request } from '../../../backend/src/v3-routes.js';

export default async function handler(req, res) {
  const handled = await handleV3Request(req, res);
  if (!handled && !res.writableEnded) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Route topilmadi' }));
  }
}
