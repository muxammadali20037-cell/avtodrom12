import jwt from 'jsonwebtoken';
import { pool } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;

function authUser(req) {
  const h = req.headers?.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  try { return jwt.verify(h.slice(7), JWT_SECRET); } catch { return null; }
}

let schemaPromise;
function ensureFreezeSchema() {
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    await pool.query(`
      ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_status_check;
      ALTER TABLE sessions ADD CONSTRAINT sessions_status_check
        CHECK (status IN ('active','frozen','completed'));
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMPTZ;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS frozen_seconds BIGINT NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_sessions_user_frozen ON sessions(user_id,status,frozen_at DESC);
    `);
  })().catch(error => { schemaPromise = null; throw error; });
  return schemaPromise;
}

async function freeze(req, res, id) {
  const user = authUser(req);
  if (!user) return res.status(401).json({ error: 'Kirish talab qilinadi' });
  try {
    await ensureFreezeSchema();
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const r = await c.query(`
        SELECT s.*,v.plate FROM sessions s JOIN vehicles v ON v.id=s.vehicle_id
        WHERE s.id=$1 AND s.user_id=$2 AND s.status='active' FOR UPDATE OF s
      `, [id, String(user.sub)]);
      if (!r.rows[0]) { await c.query('ROLLBACK'); return res.status(404).json({error:'Faol sessiya topilmadi'}); }
      const s=r.rows[0], now=new Date();
      const activeSeconds=Math.max(0,Math.floor((now-new Date(s.started_at))/1000)-Number(s.frozen_seconds||0));
      const u=await c.query(`UPDATE sessions SET status='frozen',frozen_at=$1,duration_seconds=$2 WHERE id=$3 AND user_id=$4 RETURNING id,started_at,frozen_at,duration_seconds,status`,[now,activeSeconds,id,String(user.sub)]);
      await c.query('COMMIT');
      return res.json({...u.rows[0],plate:s.plate});
    } catch(e){ await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  } catch(e){ return res.status(500).json({error:e.message||'Muzlatishda server xatosi'}); }
}

async function resume(req,res,id){
  const user=authUser(req);
  if(!user)return res.status(401).json({error:'Kirish talab qilinadi'});
  try{
    await ensureFreezeSchema();
    const c=await pool.connect();
    try{
      await c.query('BEGIN');
      const r=await c.query(`SELECT s.*,v.plate FROM sessions s JOIN vehicles v ON v.id=s.vehicle_id WHERE s.id=$1 AND s.user_id=$2 AND s.status='frozen' FOR UPDATE OF s`,[id,String(user.sub)]);
      if(!r.rows[0]){await c.query('ROLLBACK');return res.status(404).json({error:'Muzlatilgan sessiya topilmadi'});}
      const s=r.rows[0];
      const conflict=await c.query(`SELECT id FROM sessions WHERE vehicle_id=$1 AND user_id=$2 AND status='active' AND id<>$3 LIMIT 1`,[s.vehicle_id,String(user.sub),s.id]);
      if(conflict.rows[0]){await c.query('ROLLBACK');return res.status(409).json({error:'Bu avtomobil uchun boshqa faol sessiya mavjud'});}
      const now=new Date(),addedFrozen=Math.max(0,Math.floor((now-new Date(s.frozen_at))/1000)),totalFrozen=Number(s.frozen_seconds||0)+addedFrozen,activeSeconds=Math.max(0,Math.floor((now-new Date(s.started_at))/1000)-totalFrozen);
      const u=await c.query(`UPDATE sessions SET status='active',frozen_at=NULL,frozen_seconds=$1,duration_seconds=$2 WHERE id=$3 AND user_id=$4 RETURNING id,started_at,duration_seconds,status`,[totalFrozen,activeSeconds,s.id,String(user.sub)]);
      await c.query('COMMIT');
      return res.json({...u.rows[0],plate:s.plate});
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }catch(e){return res.status(500).json({error:e.message||'Davom ettirishda server xatosi'});}
}

async function frozen(req,res){
  const user=authUser(req); if(!user)return res.status(401).json({error:'Kirish talab qilinadi'});
  try{
    await ensureFreezeSchema();
    const r=await pool.query(`SELECT s.id,s.started_at,s.frozen_at,s.frozen_seconds,s.duration_seconds,s.school_id,s.group_id,s.student_id,v.plate,v.model,v.driver_name,ds.name school_name,g.name group_name,st.full_name student_name FROM sessions s JOIN vehicles v ON v.id=s.vehicle_id LEFT JOIN driving_schools ds ON ds.id=s.school_id LEFT JOIN school_groups g ON g.id=s.group_id LEFT JOIN students st ON st.id=s.student_id WHERE s.user_id=$1 AND s.status='frozen' ORDER BY s.frozen_at DESC`,[String(user.sub)]);
    return res.json(r.rows.map(x=>({...x,frozen_seconds:Number(x.frozen_seconds||0),duration_seconds:Number(x.duration_seconds||0)})));
  }catch(e){return res.status(500).json({error:e.message||'Muzlatilgan sessiyalarni olishda xatolik'});}
}

async function finishFrozen(req,res,id){
  const user=authUser(req); if(!user)return res.status(401).json({error:'Kirish talab qilinadi'});
  try{
    await ensureFreezeSchema();
    const c=await pool.connect();
    try{
      await c.query('BEGIN');
      const r=await c.query(`SELECT s.*,v.plate,ds.name school_name,g.name group_name,st.full_name student_name FROM sessions s JOIN vehicles v ON v.id=s.vehicle_id LEFT JOIN driving_schools ds ON ds.id=s.school_id LEFT JOIN school_groups g ON g.id=s.group_id LEFT JOIN students st ON st.id=s.student_id WHERE s.id=$1 AND s.user_id=$2 AND s.status='frozen' FOR UPDATE OF s`,[id,String(user.sub)]);
      if(!r.rows[0]){await c.query('ROLLBACK');return res.status(404).json({error:'Muzlatilgan sessiya topilmadi'});}
      const s=r.rows[0],amount=num(req.body?.amount); if(amount<0)return res.status(400).json({error:'Narx noto‘g‘ri'});
      let cash=num(req.body?.cashAmount),terminal=num(req.body?.terminalAmount); const method=['cash','terminal','mixed'].includes(req.body?.paymentMethod)?req.body.paymentMethod:'cash';
      if(s.student_id){if(amount!==0)return res.status(400).json({error:'Avtoshkola o‘quvchisi uchun to‘lov 0 bo‘lishi kerak'});cash=0;terminal=0;}
      else if(method==='cash'){cash=amount;terminal=0;} else if(method==='terminal'){cash=0;terminal=amount;} else if(Math.abs(cash+terminal-amount)>0.01)return res.status(400).json({error:'Naqd + terminal summasi umumiy narxga teng bo‘lishi kerak'});
      const end=new Date();
      const seconds=Math.max(0,Math.floor((end-new Date(s.started_at))/1000)-Number(s.frozen_seconds||0)-Math.max(0,Math.floor((end-new Date(s.frozen_at))/1000)));
      const u=await c.query(`UPDATE sessions SET finished_at=$1,duration_seconds=$2,amount=$3,cash_amount=$4,terminal_amount=$5,payment_method=$6,status='completed',frozen_at=NULL WHERE id=$7 AND user_id=$8 RETURNING *`,[end,seconds,amount,cash,terminal,method,id,String(user.sub)]);
      await c.query('COMMIT');
      return res.json({...u.rows[0],plate:s.plate,amount:Number(amount),cash_amount:Number(cash),terminal_amount:Number(terminal),school_name:s.school_name,group_name:s.group_name,student_name:s.student_name});
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }catch(e){return res.status(400).json({error:e.message||'FINISH bajarilmadi'});}
}

export async function handleFreezeRequest(req,res){
  const path=req.path || new URL(req.url || '/', 'http://vercel.local').pathname;
  const parts=path.split('/');
  const id=parts[3];
  if(req.method==='POST' && /^\/api\/sessions\/[^/]+\/freeze$/.test(path)) return freeze(req,res,id);
  if(req.method==='POST' && /^\/api\/sessions\/[^/]+\/resume$/.test(path)) return resume(req,res,id);
  if(req.method==='GET' && path==='/api/sessions/frozen') return frozen(req,res);
  if(req.method==='POST' && /^\/api\/sessions\/[^/]+\/finish$/.test(path)){
    const user=authUser(req); if(!user)return res.status(401).json({error:'Kirish talab qilinadi'});
    await ensureFreezeSchema();
    const check=await pool.query(`SELECT 1 FROM sessions WHERE id=$1 AND user_id=$2 AND status='frozen'`,[id,String(user.sub)]);
    if(check.rows[0])return finishFrozen(req,res,id);
  }
  return null;
}
