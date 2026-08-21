import app from "../backend/src/server.js";
import { handleFreezeRequest } from "../backend/src/freeze-routes.js";
import { readFile } from "node:fs/promises";

const frozenFinishFix = String.raw`<script>
/* ===== SAFE FROZEN FINISH ===== */
(function(){
  function safeFrozenFinish(id){
    const list = (typeof frozen !== 'undefined' && Array.isArray(frozen)) ? frozen : [];
    const v = list.find(x => String(x.id) === String(id));
    const box = document.getElementById('ff' + id);
    if(!v || !box) return;

    const school = !!v.student_id;
    const activeSeconds = Number(v.duration_seconds || 0);
    const activeMinutes = Math.floor(activeSeconds / 60);
    const escx = typeof esc === 'function' ? esc : (x => String(x ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])));
    const dtx = typeof dt === 'function' ? dt : (x => x ? new Date(x).toLocaleString('uz-UZ') : '—');
    const durx = typeof dur === 'function' ? dur : (s => Math.floor(Number(s||0)/60) + ' daqiqa');
    const moneyx = typeof money === 'function' ? money : (n => Number(n||0).toLocaleString('uz-UZ') + ' so‘m');

    box.innerHTML = '<div class="finish" style="margin-top:10px">'
      + '<div class="modalHead"><div><b style="font-size:18px">'+escx(v.plate)+' — Yakunlash</b>'
      + '<div class="muted">Kirish: '+dtx(v.started_at)+'</div></div>'
      + '<span class="badge freezeBadge">MUZLATILGAN</span></div>'
      + '<div class="kv" style="margin:14px 0">'
      + '<div><b>'+durx(activeSeconds)+'</b><span>Faol vaqt</span></div>'
      + '<div><b>'+activeMinutes+'</b><span>Daqiqa</span></div>'
      + '<div><b>'+dtx(v.frozen_at)+'</b><span>Muzlatilgan</span></div>'
      + '<div><b>'+(school?'BEPUL':'ODDIY')+'</b><span>Kirish turi</span></div></div>'
      + '<div class="muted" style="margin-bottom:10px">'
      + escx(v.model || '')
      + (v.driver_name ? ' • '+escx(v.driver_name) : '')
      + (v.school_name ? ' • '+escx(v.school_name) : '')
      + (v.group_name ? ' • '+escx(v.group_name) : '')
      + (v.student_name ? ' • '+escx(v.student_name) : '')
      + '</div>'
      + (school
        ? '<div class="badge" style="margin:8px 0">AVTOSHKOLA O‘QUVCHISI — BEPUL</div><div class="finish" style="margin-top:10px;background:#f7fbf9"><div class="muted">Yakuniy summa</div><div class="total">0 so‘m</div><div class="muted">To‘lov talab qilinmaydi</div></div>'
        : '<div class="fg" style="margin-top:12px"><label>Yakuniy summa — qo‘lda kiriting</label><input id="sfa'+id+'" type="number" min="0" step="1000" placeholder="Masalan: 50000" inputmode="numeric"></div>'
          + '<div class="muted" style="margin-top:10px">To‘lov turi</div>'
          + '<div class="payButtons"><button type="button" data-fpay="cash">Naqd</button><button type="button" data-fpay="terminal">Terminal</button><button type="button" data-fpay="mixed">Aralash</button></div>'
          + '<div id="sfsplit'+id+'" class="payments hidden"><div><label class="muted">Naqd</label><input id="sfc'+id+'" type="number" min="0" step="1000" placeholder="Naqd summa"></div><div><label class="muted">Terminal</label><input id="sft'+id+'" type="number" min="0" step="1000" placeholder="Terminal summa"></div><div><label class="muted">Jami</label><div class="total" id="sftot'+id+'">0 so‘m</div></div></div>')
      + '<div class="actions"><button type="button" class="btn green" id="sfsubmit'+id+'">✓ Tugatish</button><button type="button" class="btn light" id="sfcancel'+id+'">Bekor</button></div>'
      + '<div id="sferr'+id+'" class="err"></div></div>';

    let method = 'cash';
    const root = box.querySelector('.finish');
    root.querySelectorAll('[data-fpay]').forEach(btn => btn.addEventListener('click', () => {
      method = btn.dataset.fpay;
      root.querySelectorAll('[data-fpay]').forEach(x => x.classList.toggle('selected', x === btn));
      document.getElementById('sfsplit'+id)?.classList.toggle('hidden', method !== 'mixed');
    }));
    root.querySelector('[data-fpay="cash"]')?.classList.add('selected');

    const updateSplit = () => {
      const c = Number(document.getElementById('sfc'+id)?.value || 0);
      const t = Number(document.getElementById('sft'+id)?.value || 0);
      const out = document.getElementById('sftot'+id);
      if(out) out.textContent = moneyx(c+t);
    };
    document.getElementById('sfc'+id)?.addEventListener('input', updateSplit);
    document.getElementById('sft'+id)?.addEventListener('input', updateSplit);

    document.getElementById('sfcancel'+id)?.addEventListener('click', () => { box.innerHTML=''; });
    document.getElementById('sfsubmit'+id)?.addEventListener('click', async () => {
      const err = document.getElementById('sferr'+id);
      if(err) err.textContent = '';
      const amount = school ? 0 : Number(document.getElementById('sfa'+id)?.value || 0);
      if(!school && (!Number.isFinite(amount) || amount <= 0)){
        if(err) err.textContent = 'Yakuniy summani kiriting';
        return;
      }
      let cash = 0, terminal = 0;
      if(!school){
        if(method === 'cash') cash = amount;
        else if(method === 'terminal') terminal = amount;
        else {
          cash = Number(document.getElementById('sfc'+id)?.value || 0);
          terminal = Number(document.getElementById('sft'+id)?.value || 0);
          if(cash < 0 || terminal < 0 || Math.abs(cash + terminal - amount) > 0.01){
            if(err) err.textContent = 'Naqd + terminal summasi umumiy summaga teng bo‘lishi kerak';
            return;
          }
        }
      }
      const submit = document.getElementById('sfsubmit'+id);
      if(submit){ submit.disabled=true; submit.textContent='Saqlanmoqda...'; }
      try{
        await api('/sessions/'+id+'/finish-frozen', {
          method:'POST',
          body:JSON.stringify({amount,paymentMethod:school?'cash':method,cashAmount:cash,terminalAmount:terminal})
        });
        if(typeof toast === 'function') toast('Muzlatilgan avtomobil tugatildi va kunlik bazaga yozildi');
        if(typeof frozen !== 'undefined') frozen = frozen.filter(x => String(x.id) !== String(id));
        if(typeof loadFrozen === 'function') await loadFrozen(1);
        if(typeof loadDashboard === 'function') await loadDashboard(1);
        if(typeof loadDaily === 'function') await loadDaily();
        if(typeof go === 'function') go('finish');
      }catch(e){
        if(err) err.textContent = e.message || 'Muzlatilgan avtomobilni tugatishda xatolik';
        if(submit){ submit.disabled=false; submit.textContent='✓ Tugatish'; }
      }
    });
  }

  /* Intercept the old inline onclick before it reaches the broken openFinish(). */
  document.addEventListener('click', function(e){
    const btn = e.target && e.target.closest ? e.target.closest('button') : null;
    if(!btn) return;
    const frozenCard = btn.closest('.frozen');
    if(!frozenCard) return;
    if((btn.textContent || '').trim() !== 'Tugatish') return;
    const holder = frozenCard.nextElementSibling;
    const id = holder && holder.id && holder.id.indexOf('ff') === 0 ? holder.id.slice(2) : null;
    if(!id) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    safeFrozenFinish(id);
  }, true);
})();
</script>`;

export default async function handler(req, res) {
  const jsonRes = {
    status(code) { res.statusCode = code; return this; },
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
