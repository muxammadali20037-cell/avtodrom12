import jwt from 'jsonwebtoken';
import { pool } from '../../backend/src/db.js';

const JWT_SECRET=process.env.JWT_SECRET||'dev-only-change-me';
function json(res,status,data){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(data))}
function owner(req){try{const h=req.headers?.authorization||'';if(!h.startsWith('Bearer '))return null;return String(jwt.verify(h.slice(7),JWT_SECRET).sub||'')}catch{return null}}

export default async function handler(req,res){
  if(req.method!=='GET')return json(res,405,{error:'Method ruxsat etilmagan'});
  const user=owner(req);if(!user)return json(res,401,{error:'Kirish talab qilinadi'});
  try{
    const r=await pool.query(`
      SELECT s.id,s.vehicle_id,s.started_at,s.finished_at,s.duration_seconds,s.hourly_rate,s.minimum_payment,s.amount,
             s.status,s.payment_method,s.cash_amount,s.terminal_amount,s.school_id,s.group_id,s.student_id,
             s.manual_price,s.planned_minutes,s.avtodrom_instructor_id,s.customer_type,s.created_at,s.updated_at,
             v.plate,v.region_code,v.first_letter,v.number,v.last_letters,v.model,v.driver_name,
             ds.name AS school_name,g.name AS group_name,st.full_name AS student_name,
             COALESCE(NULLIF(TRIM(CONCAT_WS(' ',p.first_name,p.last_name)),''),'') AS instructor_name,
             p.phone AS instructor_phone
        FROM public.sessions s
        JOIN public.vehicles v ON v.id=s.vehicle_id AND v.user_id=$1
        LEFT JOIN public.driving_schools ds ON ds.id=s.school_id AND ds.owner_key=$1
        LEFT JOIN public.school_groups g ON g.id=s.group_id AND g.owner_key=$1
        LEFT JOIN public.students st ON st.id=s.student_id AND st.owner_key=$1
        LEFT JOIN public.instructors i ON i.id=s.avtodrom_instructor_id
        LEFT JOIN public.profiles p ON p.id=i.profile_id
       WHERE s.user_id=$1 AND s.status IN ('active','paused','frozen')
       ORDER BY s.started_at ASC`,[user]);
    return json(res,200,r.rows);
  }catch(e){console.error('ACTIVE V3',e);return json(res,500,{error:e.message||'Faol sessiyalarni olishda xatolik'})}
}
