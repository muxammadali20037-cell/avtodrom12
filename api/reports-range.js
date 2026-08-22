import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
function json(res, code, data){res.statusCode=code;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));}
function auth(req,res){try{const h=req.headers.authorization||'';if(!h.startsWith('Bearer ')){json(res,401,{error:'Kirish talab qilinadi'});return null;}return jwt.verify(h.slice(7),JWT_SECRET);}catch{json(res,401,{error:'Sessiya yaroqsiz yoki tugagan'});return null;}}
function validDate(x){return /^\d{4}-\d{2}-\d{2}$/.test(String(x||''));}
export default async function handler(req,res){
  if(req.method==='OPTIONS'){res.statusCode=204;return res.end();}
  const user=auth(req,res); if(!user)return;
  if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
  const from=String(req.query.from||'').trim(),to=String(req.query.to||'').trim();
  if(!validDate(from)||!validDate(to))return json(res,400,{error:'from va to YYYY-MM-DD formatida bo‘lishi kerak'});
  if(from>to)return json(res,400,{error:'Boshlanish sanasi tugash sanasidan katta bo‘lishi mumkin emas'});
  try{
    const r=await pool.query(`
      SELECT se.id,v.plate,v.model,v.driver_name,
             se.started_at,se.finished_at,
             COALESCE(se.duration_seconds,0)::int AS duration_seconds,
             COALESCE(se.amount,0)::numeric AS amount,
             COALESCE(se.cash_amount,0)::numeric AS cash_amount,
             COALESCE(se.terminal_amount,0)::numeric AS terminal_amount,
             COALESCE(se.payment_method,'cash') AS payment_method,
             ds.name AS school_name,g.name AS group_name,st.full_name AS student_name,
             st.phone AS student_phone
      FROM public.sessions se
      JOIN public.vehicles v ON v.id=se.vehicle_id
      LEFT JOIN public.driving_schools ds ON ds.id=se.school_id
      LEFT JOIN public.school_groups g ON g.id=se.group_id
      LEFT JOIN public.students st ON st.id=se.student_id
      WHERE se.user_id=$1
        AND se.status='completed'
        AND (se.started_at AT TIME ZONE 'Asia/Tashkent')::date BETWEEN $2::date AND $3::date
      ORDER BY se.started_at DESC
    `,[String(user.sub),from,to]);
    const rows=r.rows.map(x=>({...x,amount:Number(x.amount||0),cash_amount:Number(x.cash_amount||0),terminal_amount:Number(x.terminal_amount||0),duration_seconds:Number(x.duration_seconds||0)}));
    const summary=rows.reduce((a,x)=>{a.count++;a.amount+=x.amount;a.cash+=x.cash_amount;a.terminal+=x.terminal_amount;a.seconds+=x.duration_seconds;return a},{count:0,amount:0,cash:0,terminal:0,seconds:0});
    return json(res,200,{from,to,rows,summary});
  }catch(e){console.error('REPORT RANGE:',e);return json(res,500,{error:e.message||'Hisobotni olishda xatolik'});}
}
