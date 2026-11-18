/* BAZA TEKSHIRUVI — /api/health?deep=1 (18.11.2026)
   Faqat o'lcham, son va vaqt (shaxsiy ma'lumot — ism, telefon — yo'q).
   Natija 60 s keshlanadi: tez-tez ochilsa ham bazaga yuk bo'lmaydi. */
import { pool } from './db.js';

let cache = null, cacheAt = 0;
const MB = b => Math.round(Number(b || 0) / 1048576 * 10) / 10;
const safe = async (sql, params) => { try { return (await pool.query(sql, params)).rows; } catch (e) { return { error: e.message }; } };

export async function deepCheck() {
  if (cache && Date.now() - cacheAt < 60000) return { ...cache, cached: true };
  const t0 = Date.now();
  const [ver, size, limit, tables, scans, cacheHit, conns, longest, stmtsExt] = await Promise.all([
    safe(`SELECT current_setting('server_version') v`),
    safe(`SELECT pg_database_size(current_database()) b`),
    safe(`SELECT current_setting('neon.max_cluster_size', true) mb`),
    safe(`SELECT relname t, pg_total_relation_size(relid) b, n_live_tup live, n_dead_tup dead,
             GREATEST(last_autovacuum, last_vacuum) vacuumed, GREATEST(last_autoanalyze, last_analyze) analyzed
           FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 15`),
    safe(`SELECT relname t, seq_scan, seq_tup_read, idx_scan FROM pg_stat_user_tables
           WHERE seq_tup_read > 0 ORDER BY seq_tup_read DESC LIMIT 8`),
    safe(`SELECT blks_hit, blks_read, xact_commit, xact_rollback, deadlocks, temp_bytes, stats_reset
           FROM pg_stat_database WHERE datname = current_database()`),
    safe(`SELECT COALESCE(state, '?') st, COUNT(*)::int n FROM pg_stat_activity WHERE datname = current_database() GROUP BY 1`),
    safe(`SELECT COALESCE(state, '?') st, EXTRACT(EPOCH FROM now() - COALESCE(xact_start, query_start))::int sec, wait_event_type w
           FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND state <> 'idle'
             AND now() - COALESCE(xact_start, query_start) > interval '2 seconds'
           ORDER BY sec DESC NULLS LAST LIMIT 5`),
    safe(`SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'`)
  ]);
  let slowest = null;
  if (Array.isArray(stmtsExt) && stmtsExt.length) {
    slowest = await safe(`SELECT calls::int, round(mean_exec_time::numeric, 1) mean_ms, round(max_exec_time::numeric) max_ms,
        round(total_exec_time::numeric / 1000) total_s, left(regexp_replace(query, '\\s+', ' ', 'g'), 110) q
      FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      ORDER BY total_exec_time DESC LIMIT 10`);
  }
  /* Ma'lumot to'g'riligi — faqat sonlar */
  const [health] = await Promise.all([
    safe(`SELECT
      (SELECT COUNT(*) FROM sessions WHERE status = 'active' AND started_at < now() - interval '12 hours')::int active_over_12h,
      (SELECT COUNT(*) FROM sessions WHERE status IN ('frozen','paused'))::int frozen,
      (SELECT COUNT(*) FROM students WHERE active AND group_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM school_groups g WHERE g.id = students.group_id AND g.active IS NOT FALSE))::int students_in_missing_group,
      (SELECT COUNT(*) FROM students WHERE active AND NOT EXISTS (SELECT 1 FROM driving_schools d WHERE d.id = students.school_id AND d.active IS NOT FALSE))::int students_in_missing_school,
      (SELECT COUNT(*) FROM (SELECT 1 FROM students WHERE active GROUP BY owner_key, school_id, group_id, lower(btrim(full_name)) HAVING COUNT(*) > 1) x)::int duplicate_name_groups,
      (SELECT COUNT(*) FROM students WHERE active)::int students_active,
      (SELECT COUNT(*) FROM students WHERE NOT active)::int students_inactive,
      (SELECT COUNT(*) FROM sessions WHERE started_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Tashkent') AT TIME ZONE 'Asia/Tashkent')::int sessions_today,
      (SELECT COUNT(*) FROM sessions WHERE COALESCE(debt_amount, 0) > 0 AND status = 'completed')::int sessions_with_debt`)
  ]);
  const h = Array.isArray(cacheHit) && cacheHit[0] ? cacheHit[0] : {};
  const hit = Number(h.blks_hit || 0), read = Number(h.blks_read || 0);
  const limMb = Array.isArray(limit) && limit[0] ? Number(limit[0].mb) : null;
  const sizeB = Array.isArray(size) && size[0] ? Number(size[0].b) : null;
  cache = {
    version: Array.isArray(ver) && ver[0] ? ver[0].v : null,
    size_mb: MB(sizeB),
    storage_limit_mb: limMb && limMb > 0 ? limMb : null,
    used_pct: limMb && limMb > 0 && sizeB ? Math.round(sizeB / 1048576 / limMb * 1000) / 10 : null,
    cache_hit_pct: hit + read ? Math.round(hit / (hit + read) * 1000) / 10 : null,
    transactions: { commit: Number(h.xact_commit || 0), rollback: Number(h.xact_rollback || 0), deadlocks: Number(h.deadlocks || 0), temp_mb: MB(h.temp_bytes), since: h.stats_reset || null },
    connections: conns,
    busy_now: longest,
    tables: Array.isArray(tables) ? tables.map(x => ({ t: x.t, mb: MB(x.b), live: Number(x.live), dead: Number(x.dead), vacuumed: x.vacuumed, analyzed: x.analyzed })) : tables,
    full_scans: scans,
    slowest_queries: slowest,
    data: Array.isArray(health) ? health[0] : health,
    took_ms: Date.now() - t0,
    checked_at: new Date().toISOString()
  };
  cacheAt = Date.now();
  return cache;
}
