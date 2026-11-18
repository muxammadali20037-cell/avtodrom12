/* ============================================================================
   ALOQA TEKSHIRUVI (18.11.2026)

   Server o'zi tez javob beryapti (Vercel: hamma so'rov 0.01–1.8 s), lekin
   kassa kompyuterida ba'zi so'rovlarning javobi kelmay qolyapti. Qayerda
   yo'qolayotganini aniq ko'rish uchun:

     GET  /api/net              — 204, bazasiz (sahifa «server bormi» deb so'raydi)
     GET  /api/net?size=300     — 300 KB tasodifiy ma'lumot (yuklab olish tezligi)
     POST /api/net/log          — sahifa yig'gan aloqa xatolari / test natijasi
                                  → Vercel jurnaliga «NET LOG» bo'lib yoziladi
     GET  /aloqa                — kassada ochiladigan tekshiruv sahifasi

   Hech biri bazaga tegmaydi, shaxsiy ma'lumot yozilmaydi.
   ========================================================================== */
import { randomBytes } from 'node:crypto';

const NO_STORE = 'no-store, no-cache, must-revalidate';

function readSmallBody(req, limit) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (typeof req.body === 'string') { try { return Promise.resolve(JSON.parse(req.body)); } catch { return Promise.resolve({}); } }
  return new Promise(resolve => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > limit) { s = ''; req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

export async function handleNetRequest(req, res, path) {
  if (path === '/api/net' && (req.method === 'GET' || req.method === 'HEAD')) {
    const u = new URL(req.url, 'http://x');
    const kb = Math.max(0, Math.min(1024, Math.floor(Number(u.searchParams.get('size')) || 0)));
    res.setHeader('Cache-Control', NO_STORE);
    if (!kb) { res.statusCode = 204; res.end(); return true; }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.end(randomBytes(kb * 1024));
    return true;
  }
  if (path === '/api/net/log' && req.method === 'POST') {
    const b = await readSmallBody(req, 30000);
    const h = req.headers || {};
    console.log('NET LOG', JSON.stringify({
      country: h['x-vercel-ip-country'] || null, city: h['x-vercel-ip-city'] ? decodeURIComponent(h['x-vercel-ip-city']) : null,
      ua: String(h['user-agent'] || '').slice(0, 160), device: String(h['x-device'] || '').slice(0, 40),
      data: b
    }).slice(0, 12000));
    res.statusCode = 204;
    res.setHeader('Cache-Control', NO_STORE);
    res.end();
    return true;
  }
  if ((path === '/aloqa' || path === '/aloqa.html') && req.method === 'GET') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', NO_STORE);
    res.end(PAGE);
    return true;
  }
  return false;
}

const PAGE = String.raw`<!doctype html>
<html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Aloqa tekshiruvi</title>
<style>
:root{--g:#047857;--bg:#f4f7f6;--card:#fff;--t:#0f172a;--m:#64748b;--r:#b91c1c;--a:#b45309}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--t)}
main{max-width:760px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:22px;margin:0 0 4px}p.s{margin:0 0 18px;color:var(--m)}
.card{background:var(--card);border:1px solid #e2e8f0;border-radius:14px;padding:16px 18px;margin-bottom:12px}
.row{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px dashed #e2e8f0}.row:last-child{border:0}
.k{color:var(--m)}.v{font-weight:600;text-align:right}
.ok{color:var(--g)}.bad{color:var(--r)}.warn{color:var(--a)}
button{background:var(--g);color:#fff;border:0;border-radius:10px;padding:12px 18px;font-size:15px;font-weight:600;cursor:pointer}
button:disabled{opacity:.6;cursor:default}
#verdict{font-size:16px;line-height:1.5}
.bar{height:8px;background:#e2e8f0;border-radius:6px;overflow:hidden;margin-top:10px}.bar i{display:block;height:100%;width:0;background:var(--g);transition:width .3s}
</style></head><body><main>
<h1>Aloqa tekshiruvi</h1>
<p class="s">Kompyuter bilan server orasidagi aloqani 1 daqiqa davomida tekshiradi. Natija avtomatik ravishda dasturchiga ham yuboriladi.</p>
<div class="card"><button id="go">Tekshirishni boshlash</button><div class="bar"><i id="pb"></i></div><div id="st" class="k" style="margin-top:8px"></div></div>
<div class="card" id="res" hidden></div>
<div class="card" id="verdict" hidden></div>
<script>
(function(){
var $=function(i){return document.getElementById(i)};
function sleep(ms){return new Promise(function(r){setTimeout(r,ms)})}
function ping(url,ms,outside){
  var c=new AbortController(),t0=performance.now(),tm=setTimeout(function(){c.abort()},ms);
  var o=outside?{mode:'no-cors',cache:'no-store',signal:c.signal}:{cache:'no-store',signal:c.signal};
  return fetch(url,o).then(function(r){return outside?null:r.arrayBuffer()}).then(function(b){return {ok:true,ms:Math.round(performance.now()-t0),bytes:b?b.byteLength:0}},
    function(e){return {ok:false,ms:Math.round(performance.now()-t0),err:e&&e.name==='AbortError'?'timeout':String(e&&e.message||e).slice(0,60)}}).finally(function(){clearTimeout(tm)});
}
function stats(a){var ok=a.filter(function(x){return x.ok}),ms=ok.map(function(x){return x.ms}).sort(function(p,q){return p-q});
  return {n:a.length,ok:ok.length,lost:a.length-ok.length,med:ms.length?ms[Math.floor(ms.length/2)]:null,max:ms.length?ms[ms.length-1]:null,slow:ms.filter(function(x){return x>2000}).length}}
function proto(){try{var e=performance.getEntriesByType('resource').filter(function(x){return x.name.indexOf('/api/net')>=0&&x.nextHopProtocol});return e.length?e[e.length-1].nextHopProtocol:'?'}catch(x){return '?'}}
function row(k,v,c){return '<div class="row"><span class="k">'+k+'</span><span class="v '+(c||'')+'">'+v+'</span></div>'}
$('go').onclick=async function(){
  var b=this;b.disabled=true;$('res').hidden=true;$('verdict').hidden=true;
  var R={at:new Date().toISOString(),conn:null,seq:[],par:[],dl:[],out:[]};
  try{var nc=navigator.connection;if(nc)R.conn={type:nc.effectiveType,rtt:nc.rtt,down:nc.downlink,save:nc.saveData}}catch(e){}
  var total=20+8+3+6,done=0;function step(m){done++;$('pb').style.width=Math.round(done/total*100)+'%';$('st').textContent=m}
  for(var i=0;i<20;i++){R.seq.push(await ping('/api/net?i='+i+'&t='+Date.now(),8000));step('Server bilan aloqa: '+(i+1)+'/20');await sleep(1500)}
  var ps=[];for(var j=0;j<8;j++)ps.push(ping('/api/net?p='+j+'&t='+Date.now(),8000));R.par=await Promise.all(ps);for(j=0;j<8;j++)step('Bir vaqtda 8 ta so\'rov');
  for(var k=0;k<3;k++){R.dl.push(await ping('/api/net?size=300&t='+Date.now(),20000));step('Katta ma\'lumot yuklash: '+(k+1)+'/3')}
  var ext=['https://www.gstatic.com/generate_204','https://www.cloudflare.com/cdn-cgi/trace','https://www.google.com/favicon.ico'];
  for(var m=0;m<6;m++){R.out.push(await ping(ext[m%3]+'?t='+Date.now(),8000,true));step('Boshqa saytlar bilan solishtirish: '+(m+1)+'/6')}
  R.proto=proto();
  var s1=stats(R.seq),s2=stats(R.par),s3=stats(R.out),dl=R.dl.filter(function(x){return x.ok});
  var kbs=dl.length?Math.round(dl.reduce(function(a,x){return a+x.bytes/1024/(x.ms/1000)},0)/dl.length):null;
  R.sum={seq:s1,par:s2,out:s3,dl_ok:dl.length,dl_kbs:kbs};
  $('res').innerHTML='<b>Natija</b>'
    +row('Server bilan aloqa (20 marta)',s1.ok+'/20 javob · o\'rtacha '+(s1.med==null?'—':s1.med+' ms')+(s1.max!=null?' · eng sekin '+s1.max+' ms':''),s1.lost?'bad':(s1.slow?'warn':'ok'))
    +row('Bir vaqtda 8 ta so\'rov',s2.ok+'/8 javob'+(s2.max!=null?' · eng sekin '+s2.max+' ms':''),s2.lost?'bad':'ok')
    +row('Katta ma\'lumot (300 KB × 3)',dl.length+'/3'+(kbs?' · '+kbs+' KB/s':''),dl.length<3?'bad':(kbs<100?'warn':'ok'))
    +row('Boshqa saytlar (Google, Cloudflare)',s3.ok+'/6 javob'+(s3.med!=null?' · o\'rtacha '+s3.med+' ms':''),s3.lost?'bad':'ok')
    +row('Ulanish turi',R.proto==='h2'||R.proto==='h3'?R.proto+' (normal)':R.proto+(R.proto==='http/1.1'?' — antivirus yoki proksi orqali o\'tyapti':''),R.proto==='http/1.1'?'warn':'')
    +(R.conn?row('Brauzer baholashi',(R.conn.type||'?')+' · '+(R.conn.rtt!=null?R.conn.rtt+' ms':'')+' · '+(R.conn.down!=null?R.conn.down+' Mbit/s':'')):'');
  $('res').hidden=false;
  var v;
  if(s1.lost===0&&s2.lost===0&&dl.length===3&&!s1.slow)v='<b class="ok">Aloqa yaxshi.</b> Hozir server bilan aloqada muammo yo\'q.';
  else if(s3.lost>=3)v='<b class="bad">Internet uzilyapti.</b> Boshqa saytlar ham javob bermadi — muammo internet yoki routerda.';
  else v='<b class="bad">Boshqa saytlar ochilyapti, lekin dastur serveri bilan aloqa uziladi.</b> Bu kompyuter va server orasidagi yo\'lda (provayder, antivirus/proksi yoki router) bo\'lyapti. Natija dasturchiga yuborildi.';
  $('verdict').innerHTML=v;$('verdict').hidden=false;$('st').textContent='Tugadi';
  try{await fetch('/api/net/log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'aloqa-test',r:R})})}catch(e){}
  b.disabled=false;b.textContent='Yana tekshirish';
};
})();
</script></main></body></html>`;
