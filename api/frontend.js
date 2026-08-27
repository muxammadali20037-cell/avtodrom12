import { readFile } from 'node:fs/promises';

const frontendFile = new URL('../frontend/index.html', import.meta.url);

function cleanLegacyScripts(html) {
  return String(html || '')
    .replace(/<script\s+src=["']\/(?:restore-features|queue-fix|student-attendance-fix|schools-enhance|students-enhance|student-plate-instructor-fix|runtime-relations-fix)\.js["']\s*><\/script>/gi, '');
}

function repairKnownInlineSyntax(html) {
  let source = String(html || '');

  // The current legacy page has a malformed exportExcel() template literal.
  // Replace only that function, leaving the rest of the working application intact.
  const start = source.indexOf('function exportExcel(){');
  const end = source.indexOf('async function historySearch(){', start);
  if (start >= 0 && end > start) {
    const safeExport = `function exportExcel(){
  const rows=daily?.rows||[];
  if(!rows.length){
    showToast('Eksport uchun ma’lumot yo‘q',true);
    return;
  }
  const headers=['Raqam','Kirish','Chiqish','Vaqt','Avtoshkola','Guruh','O‘quvchi','Kelgan dars','Naqd','Terminal','Jami'];
  const body=rows.map(r=>{
    const att=Number(r.attendance_count||0);
    const values=[
      r.plate||'',
      dt(r.started_at),
      dt(r.finished_at),
      dur(r.duration_seconds),
      r.school_name||'',
      r.group_name||'',
      r.student_name||'',
      r.student_name?att:'',
      Number(r.cash_amount||0),
      Number(r.terminal_amount||0),
      Number(r.amount||0)
    ];
    return '<tr>'+values.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>';
  }).join('');
  const head=headers.map(v=>'<th>'+esc(v)+'</th>').join('');
  const htmlOut='<!doctype html><html><head><meta charset="utf-8"><style>table{border-collapse:collapse;font-family:Arial}th,td{border:1px solid #999;padding:6px;white-space:nowrap}th{background:#e8f4ee}</style></head><body><table><tr>'+head+'</tr>'+body+'</table></body></html>';
  const blob=new Blob(['\\ufeff',htmlOut],{type:'application/vnd.ms-excel;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download='avtodrom-'+(($('reportDate')&&$('reportDate').value)||localDateISO(0))+'.xls';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}`;
    source = source.slice(0,start) + safeExport + '\n' + source.slice(end);
  }

  return source;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Method ruxsat etilmagan' }));
    return;
  }

  try {
    let html = await readFile(frontendFile, 'utf8');
    html = cleanLegacyScripts(html);
    html = repairKnownInlineSyntax(html);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('X-Avtodrom-Frontend', 'clean-v2');
    return res.end(html);
  } catch (error) {
    console.error('FRONTEND SERVE ERROR:', error?.message || error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(JSON.stringify({ error: 'Frontend yuklanmadi' }));
  }
}
