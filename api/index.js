import app from "../backend/src/server.js";
import { handleFreezeRequest } from "../backend/src/freeze-routes.js";
import { readFile } from "node:fs/promises";

const frozenFinishFix = String.raw`<script>
function frozenFinish(id){let v=frozen.find(x=>x.id===id);if(!v)return;let box=document.getElementById('ff'+id);if(!box)return;box.innerHTML='<div class="finish"><b>'+esc(v.plate)+' — Yakunlash</b><div class="muted">Kirish: '+dt(v.started_at)+'</div><div class="muted">Muzlatilgan vaqt: '+dur(v.duration_seconds)+'</div>'+(v.student_id?'<div class="badge" style="margin-top:9px">AVTOSHKOLA O‘QUVCHISI — BEPUL</div>':'<div class="fg" style="margin-top:12px"><label>Yakuniy summa — qo‘lda</label><input id="fa'+id+'" type="number" min="0" placeholder="50000"></div><div class="payButtons"><button onclick="chooseFrozenPay(\''+id+'\',\'cash\')">Naqd</button><button onclick="chooseFrozenPay(\''+id+'\',\'terminal\')">Terminal</button><button onclick="chooseFrozenPay(\''+id+'\',\'mixed\')">Aralash</button></div><div id="fsplit'+id+'" class="payments hidden"><input id="fc'+id+'" type="number" min="0" placeholder="Naqd"><input id="ft'+id+'" type="number" min="0" placeholder="Terminal"><div class="total" id="ftot'+id+'">0 so‘m</div></div>')+'<div class="actions"><button class="btn green" onclick="frozenFinishSubmit(\''+id+'\')">✓ Tugatish</button><button class="btn light" onclick="document.getElementById(\'ff'+id+'\').innerHTML=\'\'">Bekor</button></div><div id="ferr'+id+'" class="err"></div></div>';window.frozenPay=window.frozenPay||{};window.frozenPay[id]='cash'}
function chooseFrozenPay(id,m){window.frozenPay=window.frozenPay||{};window.frozenPay[id]=m;document.querySelectorAll('#ff'+id+' .payButtons button').forEach((b,i)=>b.classList.toggle('selected',i===(['cash','terminal','mixed'].indexOf(m))));document.getElementById('fsplit'+id)?.classList.toggle('hidden',m!=='mixed')}
async function frozenFinishSubmit(id){let v=frozen.find(x=>x.id===id);if(!v)return;let amount=v.student_id?0:Number(document.getElementById('fa'+id)?.value||0),m=v.student_id?'cash':((window.frozenPay||{})[id]||'cash'),cash=m==='cash'?amount:0,term=m==='terminal'?amount:0;if(m==='mixed'){cash=Number(document.getElementById('fc'+id)?.value||0);term=Number(document.getElementById('ft'+id)?.value||0);if(Math.abs(cash+term-amount)>0.01){document.getElementById('ferr'+id).textContent='Naqd + terminal umumiy summaga teng bo‘lishi kerak';return}}try{await api('/sessions/'+id+'/finish',{method:'POST',body:JSON.stringify({amount,paymentMethod:m,cashAmount:cash,terminalAmount:term})});toast('Muzlatilgan avtomobil tugatildi va kunlik bazaga yozildi');frozen=frozen.filter(x=>x.id!==id);await loadFrozen();await loadDashboard(1);go('finish')}catch(e){document.getElementById('ferr'+id).textContent=e.message||'Tugatishda xatolik'}}
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
    const originalSendFile = res.sendFile.bind(res);
    res.sendFile = async (filePath, options, callback) => {
      if (String(filePath).endsWith("/frontend/index.html")) {
        try {
          const html = await readFile(filePath, "utf8");
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          return res.end(html.replace("</body>", frozenFinishFix + "</body>"));
        } catch (error) {
          if (typeof callback === "function") return callback(error);
          res.statusCode = 500;
          return res.end("Frontend yuklanmadi");
        }
      }
      return originalSendFile(filePath, options, callback);
    };
  }

  return app(req, res);
}
