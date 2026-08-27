import { readFile } from 'node:fs/promises';

const frontendFile = new URL('../frontend/index.html', import.meta.url);
const EXTRA_SCRIPTS = [
  '/schools-enhance.js',
  '/student-attendance-fix.js',
  '/restore-features.js',
  '/queue-fix.js',
  '/runtime-relations-fix.js'
];

function sanitize(html) {
  const startMarker = '<script>\n/* =========================================================\n   AVTODROM — RELATION/UI FIX LAYER';
  const start = html.indexOf(startMarker);
  if (start < 0) return html;

  const endMarker = '</body></html>`;';
  const templateEnd = html.indexOf(endMarker, start);
  if (templateEnd < 0) return html;

  const scriptEnd = html.lastIndexOf('</script>', templateEnd);
  if (scriptEnd < start) return html;

  return html.slice(0, start) + html.slice(scriptEnd + '</script>'.length);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Method ruxsat etilmagan' }));
  }

  try {
    const raw = await readFile(frontendFile, 'utf8');
    let html = sanitize(raw);
    const injections = EXTRA_SCRIPTS.map(src => `<script src="${src}"></script>`).join('');
    html = html.replace('</body>', injections + '</body>');

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(html);
  } catch (error) {
    console.error('FRONTEND SERVE ERROR:', error?.message || error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Frontend yuklanmadi' }));
  }
}
