/* ============================================================================
   SERVICE WORKER — internet yo'q paytda ham kassa ochilsin

   /sw.js manzilida beriladi (api/index.js). Brauzer sahifani bir marta
   internet bilan ochgach, sahifa (index.html) va kutubxonalar (shriftlar,
   ikonlar, QR, Excel) kompyuterda saqlanadi:
     • sahifa — avval internetdan (har doim eng yangi versiya), internet
       bo'lmasa yoki 6 soniyada javob kelmasa — saqlangan nusxa;
     • CDN kutubxonalari — saqlangan nusxa (bir marta yuklanadi);
     • /api/ — HECH QACHON saqlanmaydi (ma'lumot doim serverdan; internetsiz
       amallar sahifaning o'zida navbatga yoziladi).
   Versiya o'zgarsa (VERSION) eski saqlanganlar o'chiriladi.
   ========================================================================== */

export const SW_SOURCE = String.raw`/* Avtodrom 12 — internetsiz rejim (service worker) */
var VERSION = 'v1';
var SHELL = 'avtodrom-shell-' + VERSION;
var LIBS = 'avtodrom-libs-' + VERSION;
var CDN = /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;
var PRE_LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-solid-900.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/webfonts/fa-regular-400.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap'
];

self.addEventListener('install', function (e) {
  self.skipWaiting();
  e.waitUntil((async function () {
    try {
      var c = await caches.open(SHELL);
      var r = await fetch(new Request('/', { cache: 'reload', credentials: 'same-origin' }));
      if (r && r.ok) await c.put('/', r);
    } catch (err) { /* keyingi ochilishda saqlanadi */ }
    try {
      var l = await caches.open(LIBS);
      await Promise.all(PRE_LIBS.map(function (u) {
        return l.match(u).then(function (m) {
          if (m) return null;
          return fetch(u, { mode: 'cors', credentials: 'omit' }).then(function (res) {
            if (res && res.ok) return l.put(u, res);
          }).catch(function () {});
        });
      }));
    } catch (err) { /* noop */ }
  })());
});

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.filter(function (k) {
      return k.indexOf('avtodrom-') === 0 && k !== SHELL && k !== LIBS;
    }).map(function (k) { return caches.delete(k); }));
    await self.clients.claim();
  })());
});

function shellKey(url) {
  var p = url.pathname;
  if (p === '/' || p === '/index.html') return '/';
  return p;
}

function timeout(ms) {
  return new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, ms); });
}

async function pageFirstNetwork(req, url) {
  var c = await caches.open(SHELL);
  var key = shellKey(url);
  var net = fetch(req).then(function (res) {
    if (res && res.ok && res.type === 'basic') c.put(key, res.clone()).catch(function () {});
    return res;
  });
  try {
    var res = await Promise.race([net, timeout(6000)]);
    if (res && res.status >= 500) {
      var old = await c.match(key);
      if (old) return old;
    }
    return res;
  } catch (err) {
    var hit = await c.match(key);
    if (hit) { net.catch(function () {}); return hit; }
    return net;
  }
}

async function libCacheFirst(req) {
  var c = await caches.open(LIBS);
  var hit = await c.match(req, { ignoreVary: true });
  if (hit) return hit;
  var res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()).catch(function () {});
  return res;
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin === self.location.origin) {
    if (url.pathname.indexOf('/api/') === 0 || url.pathname === '/sw.js') return;
    if (req.mode === 'navigate' || req.destination === 'document') {
      e.respondWith(pageFirstNetwork(req, url));
    }
    return;
  }
  if (CDN.test(req.url)) e.respondWith(libCacheFirst(req));
});
`;
