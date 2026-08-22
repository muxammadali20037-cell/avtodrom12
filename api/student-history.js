import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
function json(res, code, data){res.statusCode=code;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data));}
function auth(req,res){try{const h=req.headers.authorization||'';if(!h.startsWith('Bearer ')){json(res,401,{error:'Kirish talab qilinadi'});return null;}return jwt.verify(h.slice(7),JWT_SECRET);}catch{json(res,401,{error:'Sessiya yaroqsiz yoki tugagan'});return null;}}

export default async function handler(req,res){
  if(req.method==='OPTIONS'){res.statusCode=204;return res.end();}
  const user=auth(req,res); if(!user)return;
  if(req.method!=='GET')return json(res,405,{error:'Method not allowed'});
  const studentId=String(req.query.studentId||'').trim();
  if(!studentId)return json(res,400,{error:'studentId kerak'});
  try{
    const s=await pool.query(`
      SELECT st.id,st.full_name,st.phone,st.plate,st.notes,
             COALESCE(st.attendance_count,0)::int AS saved_attendance_count,
             ds.name AS school_name,g.name AS group_name
      FROM public.students st
      JOIN public.driving_schools ds ON ds.id=st.school_id
      LEFT JOIN public.school_groups g ON g.id=st.group_id
      WHERE st.id=$1 AND st.owner_key=$2
      LIMIT 1
    `,[studentId,String(user.sub)]);
    if(!s.rows[0])return json(res,404,{error:'O‘quvchi topilmadi'});
    const r=await pool.query(`
      SELECT se.id,se.status,se.started_at,se.finished_at,
             COALESCE(se.duration_seconds,0)::int AS duration_seconds,
             COALESCE(se.amount,0)::numeric AS amount,
             COALESCE(se.cash_amount,0)::numeric AS cash_amount,
             COALESCE(se.terminal_amount,0)::numeric AS terminal_amount,
             COALESCE(se.payment_method,'cash') AS payment_method,
             v.plate,v.model,v.driver_name,
             ds.name AS school_name,g.name AS group_name
      FROM public.sessions se
      JOIN public.vehicles v ON v.id=se.vehicle_id
      LEFT JOIN public.driving_schools ds ON ds.id=se.school_id
      LEFT JOIN public.school_groups g ON g.id=se.group_id
      WHERE se.student_id=$1 AND se.user_id=$2
      ORDER BY se.started_at DESC
    `,[studentId,String(user.sub)]);
    const completed=r.rows.filter(x=>x.status==='completed').length;
    const saved=Number(s.rows[0].saved_attendance_count||0);
    return json(res,200,{student:s.rows[0],rows:r.rows,totalAttendance:saved,completedSessions:completed});
  }catch(e){console.error('STUDENT HISTORY:',e);return json(res,500,{error:e.message||'O‘quvchi tarixini olishda xatolik'});}
}
