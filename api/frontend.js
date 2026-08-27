import { readFile } from 'node:fs/promises';

const frontendFile = new URL('../frontend/index.html', import.meta.url);

function repairEmbeddedScriptTags(html) {
  let source = String(html || '');

  // exportExcel() contains an HTML document inside a JavaScript template literal.
  // A literal </script> closes the outer HTML script tag in the browser and
  // causes the whole application script to stop parsing. Escape only that
  // closing tag while leaving the application logic unchanged.
  const start = source.indexOf('function exportExcel(){');
  const end = source.indexOf('async function historySearch(){', start);
  if (start >= 0 && end > start) {
    const before = source.slice(0, start);
    const block = source.slice(start, end).replace(/<\/script>/gi, '<\\/script>');
    source = before + block + source.slice(end);
  }

  // These known relation messages were inserted with an accidental raw newline
  // inside a single-quoted string. Escape just those line breaks.
  source = source
    .replace("showToast('Kutishdagi mijoz topilmadi.\n", "showToast('Kutishdagi mijoz topilmadi.\\n")
    .replace("showToast('O‘quvchi topilmadi.\n", "showToast('O‘quvchi topilmadi.\\n")
    .replace("showToast('Guruh topilmadi.\n", "showToast('Guruh topilmadi.\\n");

  return source;
}

function patchPlateParser(html) {
  let source = repairEmbeddedScriptTags(html);

  // Preserve the current app and only provide the V3 START code with a stable parser.
  source = source.replace(
    "const parsed=typeof parsePlate==='function'?parsePlate(fullPlate):null;",
    "const parsed=window.__avtodromParsePlate(fullPlate);"
  );
  source = source.replace(
    "const p=typeof parsePlate==='function'?parsePlate(body):null;",
    "const p=window.__avtodromParsePlate(body);"
  );

  const helper = `<script>
(function(){
  'use strict';
  window.__avtodromParsePlate = function(value){
    const q=String(value??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(!q) return null;
    let m=q.match(/^(\\d{2})([A-Z])(\\d{3})([A-Z]{2})$/);
    if(m) return {region:m[1],body:m[2]+m[3]+m[4],firstLetter:m[2],number:m[3],lastLetters:m[4]};
    m=q.match(/^([A-Z])(\\d{3})([A-Z]{2})$/);
    if(m) return {body:q,firstLetter:m[1],number:m[2],lastLetters:m[3]};
    m=q.match(/^(\\d{3})([A-Z]{3})$/);
    if(m) return {body:q,firstLetter:m[2][0],number:m[1],lastLetters:m[2].slice(1)};
    return null;
  };
})();
</script>`;

  if (!source.includes('window.__avtodromParsePlate = function')) {
    source = source.replace('</body>', helper + '</body>');
  }
  return source;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Method ruxsat etilmagan' }));
  }

  try {
    const rawHtml = await readFile(frontendFile, 'utf8');
    const html = patchPlateParser(rawHtml);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('X-Avtodrom-Frontend', 'canonical-clean-v4');
    return res.end(html);
  } catch (error) {
    console.error('FRONTEND SERVE ERROR:', error?.message || error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Frontend yuklanmadi' }));
  }
}
