import { readFile } from 'node:fs/promises';

const frontendFile = new URL('../frontend/index.html', import.meta.url);

function patchPlateParser(html) {
  let source = String(html || '');

  // The current V3 start code calls parsePlate(), but the main app may contain
  // an older parser that rejects the compact 3-digit + 3-letter form (111AAA).
  // Patch only the two V3 call sites; everything else stays untouched.
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
    if(m){
      return {
        region:m[1],
        body:m[2]+m[3]+m[4],
        firstLetter:m[2],
        number:m[3],
        lastLetters:m[4]
      };
    }

    m=q.match(/^([A-Z])(\\d{3})([A-Z]{2})$/);
    if(m){
      return {
        body:q,
        firstLetter:m[1],
        number:m[2],
        lastLetters:m[3]
      };
    }

    m=q.match(/^(\\d{3})([A-Z]{3})$/);
    if(m){
      return {
        body:q,
        firstLetter:m[2][0],
        number:m[1],
        lastLetters:m[2].slice(1)
      };
    }

    return null;
  };
})();
</script>`;

  if (!source.includes('__avtodromParsePlate')) {
    source = source.replace('</body>', helper + '</body>');
  } else if (!source.includes('window.__avtodromParsePlate')) {
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
    let html = await readFile(frontendFile, 'utf8');
    html = patchPlateParser(html);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('X-Avtodrom-Frontend', 'canonical-clean-v2');
    return res.end(html);
  } catch (error) {
    console.error('FRONTEND SERVE ERROR:', error?.message || error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Frontend yuklanmadi' }));
  }
}
