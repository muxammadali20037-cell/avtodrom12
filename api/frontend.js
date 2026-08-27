import { readFile } from 'node:fs/promises';

const frontendFile = new URL('../frontend/index.html', import.meta.url);

function patchPlateParser(html) {
  let source = String(html || '');

  // Keep the existing app intact. Only normalize the two V3 places that need
  // a reliable plate parser, and provide that parser before any user action.
  source = source.replace(
    "const parsed=typeof parsePlate==='function'?parsePlate(fullPlate):null;",
    "const parsed=window.__avtodromParsePlate(fullPlate);"
  );
  source = source.replace(
    "const p=typeof parsePlate==='function'?parsePlate(body):null;",
    "const p=window.__avtodromParsePlate(body);"
  );

  // IMPORTANT: do not use source.includes('__avtodromParsePlate') here,
  // because the call sites above intentionally contain that name too.
  const helper = `<script>
(function(){
  'use strict';
  window.__avtodromParsePlate = function(value){
    const q=String(value??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(!q) return null;

    // Full plate: 01 A 111 AA / 01A111AA
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

    // Body: A111AA
    m=q.match(/^([A-Z])(\\d{3})([A-Z]{2})$/);
    if(m){
      return {
        body:q,
        firstLetter:m[1],
        number:m[2],
        lastLetters:m[3]
      };
    }

    // Body: 111AAA
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

  // Inject exactly once. Check for the actual function definition, not the
  // call-site identifier, so the helper can never be skipped accidentally.
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
    let html = await readFile(frontendFile, 'utf8');
    html = patchPlateParser(html);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('X-Avtodrom-Frontend', 'canonical-clean-v3');
    return res.end(html);
  } catch (error) {
    console.error('FRONTEND SERVE ERROR:', error?.message || error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Frontend yuklanmadi' }));
  }
}
