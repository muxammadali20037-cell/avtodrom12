import jwt from 'jsonwebtoken';
import { pool } from '../backend/src/db.js';
const JWT_SECRET=process.env.JWT_SECRET||'dev-only-change-me';
const text=v=>String(v??'').trim();
function json(res,status,data){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');return res.end(JSON.stringify(data));}
function auth(req){try{const h=req.headers?.authorization||'';if(!h.startsWith('Bearer '))return null;return String(jwt.verify(h.slice(7),JWT_SECRET).sub||'')}catch{return null}}
export default async function handler(req,res){
 if(req.method!=='GET')return json(res,405,{error:'Method ruxsat etilmagan'});
 const user=auth(req);if(!user)return json(res,401,{error:'Kirish talab qilinadi'});
 try{
  const url=new URL(req.url,'http://localhost');
  const id=text(req.query?.id||url.searchParams.get('id'));
  const date=text(req.query?.date||url.searchParams.get('date'))||new Date().toISOString().slice(0,10);
  if(!id)return json(res,400,{error:'Instruktor ID kerak'});
  const inst=await pool.query(`SELECT i.id,i.bio AS full_name,i.active,i.settings->>'school_id' AS school_id,ds.name AS school_name FROM public.instructors i LEFT JOIN public.driving_schools ds ON ds.id::text=i.settings->>'school_id' AND ds.owner_key=$1 WHERE i.id=$2 AND i.settings->>'owner_key'=$1 LIMIT 1`,[user,id]);
  if(!inst.rows[0])return json(res,404,{error:'Instruktor topilmadi'});
  const r=await pool.query(`SELECT s.id,s.started_at,s.finished_at,COALESCE(s.duration_seconds,0) AS duration_seconds,COALESCE(s.amount,0) AS amount,s.status,s.hourly_rate,s.customer_type,s.payment_method,v.plate,v.model,v.driver_name,st.full_name AS student_name,ds.name AS school_name,g.name AS group_name FROM public.sessions s JOIN public.vehicles v ON v.id=s.vehicle_id LEFT JOIN public.students st ON st.id=s.student_id LEFT JOIN public.driving_schools ds ON ds.id=s.school_id LEFT JOIN public.school_groups g ON g.id=s.group_id WHERE s.user_id=$1 AND s.avtodrom_instructor_id=$2 AND s.started_at >= ($3::date AT TIME ZONE 'Asia/Tashkent') AND s.started_at < (($3::date + INTERVAL '1 day') AT TIME ZONE 'Asia/Tashkent') ORDER BY s.started_at ASC`,[user,id,date]);
  const rows=r.rows.map(x=>({...x,amount:Number(x.amount||0),duration_seconds:Number(x.duration_seconds||0),customer_type:x.customer_type||(x.student_name?'school':'ordinary')}));
  const summary={total:rows.length,students:rows.filter(x=>x.customer_type==='school').length,private:rows.filter(x=>x.customer_type!=='school').length,total_minutes:Math.round(rows.reduce((a,x)=>a+x.duration_seconds,0)/60),total_amount:rows.reduce((a,x)=>a+x.amount,0)};
  return json(res,200,{date,instructor:inst.rows[0],summary,rows});
 }catch(e){console.error('INSTRUCTOR DAILY ERROR:',e);return json(res,500,{error:e.message||'Instruktor hisoboti xatosi'});}
}
