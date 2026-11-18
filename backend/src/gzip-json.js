/* KATTA JSON JAVOB — gzip bilan (18.11.2026).
   Vercel funksiyasining javobi 4.5 MB dan oshsa, platforma uni umuman
   yubormaydi. O'quvchilar ro'yxati ~9 600 ta bo'lganda 5.8 MB ga yetdi:
   ro'yxat kelmay qoldi, kassada birorta o'quvchi topilmadi, admin
   panelda hamma avtoshkolada «0 o'quvchi» chiqdi. Gzip bilan shu ro'yxat
   ~0.35 MB. Brauzer gzip'ni o'zi ochadi (fetch). */
import zlib from 'node:zlib';

export function endJson(res, body, req) {
  const r = req || res.req;
  const ae = String((r && r.headers && r.headers['accept-encoding']) || '');
  if (body.length > 200000 && /\bgzip\b/i.test(ae)) {
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    return res.end(zlib.gzipSync(body));
  }
  return res.end(body);
}
