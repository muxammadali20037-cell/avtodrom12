import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';

function send(res,status,data){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function getUserId(req){
  try{
    const h=req.headers?.authorization||'';
    if(!h.startsWith('Bearer ')) return null;
    const token=jwt.verify(h.slice(7),JWT_SECRET);
    return String(token.sub);
  }catch{return null;}
}

export default async function handler(req,res){
  if(req.method!=='GET') return send(res,405,{error:'Faqat GET ishlaydi'});
  const userId=getUserId(req);
  if(!userId) return send(res,401,{error:'Kirish talab qilinadi'});

  const url=new URL(req.url||'/api/student-history','http://localhost');
  const studentId=String(url.searchParams.get('studentId')||'').trim();
  if(!studentId) return send(res,400,{error:'studentId kerak'});

  try{
    const student=await pool.query(`
      SELECT st.id,st.full_name,st.birth_date,st.phone,st.plate,
             s.name school_name,g.name group_name,
             COALESCE(st.manual_attendance_count,0) manual_attendance_count,
             (SELECT COUNT(*)::int FROM sessions se WHERE se.student_id=st.id AND se.status='completed') session_attendance_count
      FROM students st
      JOIN driving_schools s ON s.id=st.school_id
      LEFT JOIN school_groups g ON g.id=st.group_id
      WHERE st.id=$1 AND st.owner_key=$2 AND st.active=true
      LIMIT 1
    `,[studentId,userId]);

    if(!student.rows[0]) return send(res,404,{error:'O‘quvchi topilmadi'});
    const st=student.rows[0];

    const history=await pool.query(`
      SELECT se.id,se.started_at,se.finished_at,
             GREATEST(0,EXTRACT(EPOCH FROM (COALESCE(se.finished_at,NOW())-se.started_at)))::int AS duration_seconds,
             COALESCE(se.amount,0) AS amount,
             COALESCE(se.payment_method,'cash') AS payment_method,
             COALESCE(se.cash_amount,0) AS cash_amount,
             COALESCE(se.terminal_amount,0) AS terminal_amount,
             v.plate,
             ds.name AS school_name,
             g.name AS group_name,
             st.full_name AS student_name
      FROM sessions se
      JOIN vehicles v ON v.id=se.vehicle_id
      LEFT JOIN driving_schools ds ON ds.id=se.school_id
      LEFT JOIN school_groups g ON g.id=se.group_id
      JOIN students st ON st.id=se.student_id
      WHERE se.user_id=$1 AND se.student_id=$2 AND se.status='completed'
      ORDER BY se.started_at DESC
    `,[userId,studentId]);

    const attendanceCount=Number(st.manual_attendance_count||0)+Number(st.session_attendance_count||0);
    return send(res,200,{student:{...st,attendance_count:attendanceCount},rows:history.rows});
  }catch(error){
    console.error('STUDENT HISTORY ERROR:',error);
    return send(res,500,{error:'O‘quvchi tarixini olishda server xatosi'});
  }
}
