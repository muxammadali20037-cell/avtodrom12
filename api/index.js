import app from "../backend/src/server.js";
import { handleFreezeRequest } from "../backend/src/freeze-routes.js";
import { readFile } from "node:fs/promises";

const frozenFinishFix = String.raw`<script>
function frozenFinish(id){
  const v=(window.frozen||[]).find(x=>String(x.id)===String(id));
  const box=document.getElementById('ff'+id);
  if(!v||!box)return;
  const school=!!v.student_id;
  box.innerHTML='<div class="finish" style="margin-top:10px"><div class="modalHead"><div><b style="font-size:18px">'+esc(v.plate)+' — Yakunlash</b><div class="muted">Kirish: '+dt(v.started_at)+'</div></div><span class="badge freezeBadge">MUZLATILGAN</span></div><div class="kv" style="margin:14px 0"><div><b>'+dur(v.duration_seconds)+'</b><span>Faol vaqt</span></div><div><b>'+Math.floor(Number(v.duration_seconds||0)/60)+'</b><span>Daqiqa</span></div><div><b>'+dt(v.frozen_at)+'</b><span>Muzlatilgan</span></div><div><b>'+(school?'BEPUL':'ODDIY')+'</b><span>Kirish turi</span></div></div><div class="muted" style="margin-bottom:10px">'+esc(v.model||'')+(v.driver_name?' • '+esc(v.driver_name):'')+(v.school_name?' • '+esc(v.school_name):'')+(v.group_name?' • '+esc(v.group_name):'')+(v.student_name?' • '+esc(v.student_name):'')+'</div>'+(school?'<div class="badge" style="margin:8px 0">AVTOSHKOLA O‘QUVCHISI — BEPUL</div><div class="finish" style="margin-top:10px;background:#f7fbf9"><div class="muted">Yakuniy summa</div><div class="total">0 so‘m</div><div class="muted">To‘lov talab qilinmaydi</div></div>':'<div class="fg" style="margin-top:12px"><label>Yakuniy summa — qo‘lda kiriting</label><input id="fa'+id+'" type="number" min="0" step="1000" placeholder="Masalan: 50000" inputmode="numeric"></div><div class="muted" style="margin-top:10px">To‘lov turi</div><div class="payButtons"><button type="button" onclick="chooseFrozenPay(\\''+id+'\\',\\'cash\\')">Naqd</button><button type="button" onclick="chooseFrozenPay(\\''+id+'\\',\\'terminal\\')">Terminal</button><button type="button" onclick="chooseFrozenPay(\\''+id+'\\',\\'mixed\\')">Aralash</button></div><div id="fsplit'+id+'" class="payments hidden"><div><label class="muted">Naqd</label><input id="fc'+id+'" type="number" min="0" step="1000" placeholder="Naqd summa"></div><div><label class="muted">Terminal</label><input id="ft'+id+'" type="number" min="0" step="1000" placeholder="Terminal summa"></div><div><label class="muted">Jami</label><div class="total" id="ftot'+id+'">0 so‘m</div></div></div>')+'<div class="actions"><button type="button" class="btn green" onclick="frozenFinishSubmit(\\''+id+'\\')">✓ Tugatish</button><button type="button" class="btn light" onclick="document.getElementById(\\'ff'+id+'\\').innerHTML=\\'\\'">Bekor</button></div><div id="ferr'+id+'" class="err"></div></div>';
  window.frozenPay=window.frozenPay||{};
  window.frozenPay[id]=school?'cash':'cash';
  if(!school)chooseFrozenPay(id,'cash');
}
function chooseFrozenPay(id,m){
  window.frozenPay=window.frozenPay||{};
  window.frozenPay[id]=m;
  const box=document.getElementById('ff'+id);
  if(!box)return;
  box.querySelectorAll('.payButtons button').forEach((b,i)=>b.classList.toggle('selected',i===(['cash','terminal','mixed'].indexOf(m))));
  document.getElementById('fsplit'+id)?.classList.toggle('hidden',m!=='mixed');
}
function updateFrozenSplit(id){
  const c=Number(document.getElementById('fc'+id)?.value||0),t=Number(document.getElementById('ft'+id)?.value||0),el=document.getElementById('ftot'+id);
  if(el)el.textContent=money(c+t);
}
document.addEventListener('input',e=>{const id=e.target?.id||'';if(id.startsWith('fc')||id.startsWith('ft'))updateFrozenSplit(id.slice(2))});
async function frozenFinishSubmit(id){
  const v=(window.frozen||[]).find(x=>String(x.id)===String(id));
  if(!v)return;
  const err=document.getElementById('ferr'+id),school=!!v.student_id,amount=school?0:Number(document.getElementById('fa'+id)?.value||0),method=school?'cash':((window.frozenPay||{})[id]||'cash');
  let cash=0,terminal=0;
  if(!school){
    if(!Number.isFinite(amount)||amount<0){if(err)err.textContent='Summani to‘g‘ri kiriting';return}
    if(method==='cash')cash=amount;
    else if(method==='terminal')terminal=amount;
    else{cash=Number(document.getElementById('fc'+id)?.value||0);terminal=Number(document.getElementById('ft'+id)?.value||0);if(cash<0||terminal<0||Math.abs(cash+terminal-amount)>0.01){if(err)err.textContent='Naqd + terminal summasi umumiy summaga teng bo‘lishi kerak';return}}
  }
  try{
    await api('/sessions/'+id+'/finish-frozen',{method:'POST',body:JSON.stringify({amount,paymentMethod:method,cashAmount:cash,terminalAmount:terminal})});
    toast('Muzlatilgan avtomobil tugatildi va kunlik bazaga yozildi');
    frozen=(window.frozen||[]).filter(x=>String(x.id)!==String(id));
    await loadFrozen(1);await loadDashboard(1);await loadDaily();go('finish');
  }catch(e){if(err)err.textContent=e.message||'Muzlatilgan avtomobilni tugatishda xatolik'}
}
</script>`;

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

  if (req.method === "GET" && !req.url?.startsWith("/api/") && req.url !== "/favicon.ico") {
    res.sendFile = async (filePath, options, callback) => {
      try {
        if (String(filePath).endsWith("/frontend/index.html")) {
          const html = await readFile(filePath, "utf8");
          if (!res.headersSent) {
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html; charset=utf-8");
          }
          return res.end(html.replace("</body>", frozenFinishFix + "</body>"));
        }
        const data = await readFile(filePath);
        if (!res.headersSent) res.statusCode = 200;
        return res.end(data);
      } catch (error) {
        if (typeof callback === "function") return callback(error);
        if (!res.headersSent) res.statusCode = 500;
        return res.end("Frontend yuklanmadi");
      }
    };
  }

  return app(req, res);
}
