'use strict';

const { Pool } = require('pg');

let _pool = null;
function defaultPool() {
  if (_pool) return _pool;
  // Same env-var convention as AdminPrompts/aurora.js — DATABASE_URL
  // wins, otherwise build from per-field DB_* (matches the per-field
  // SecretsManager wiring on the ECS task definition).
  let url = process.env.DATABASE_URL;
  if (!url && process.env.DB_HOST) {
    const u = encodeURIComponent(process.env.DB_USER || '');
    const p = encodeURIComponent(process.env.DB_PASSWORD || '');
    url = `postgresql://${u}:${p}@${process.env.DB_HOST}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'botnim_staging'}`;
  }
  if (!url) {
    throw new Error('Aurora-backed AdminSources requires DB_HOST/etc env vars or DATABASE_URL');
  }
  _pool = new Pool({ connectionString: url, max: 4 });
  return _pool;
}

const SPARKLINE_WINDOW = 30;  // last N snapshots per spec Q5=a

async function getContextStats(bot, { pool = defaultPool() } = {}) {
  // Single round trip via two CTEs:
  //   recent: last SPARKLINE_WINDOW aggregate ('*') snapshots per context
  //   sources: count of distinct non-aggregate source_ids per context
  const sql = `
    WITH recent AS (
      SELECT context, snapshot_at, doc_count,
             ROW_NUMBER() OVER (PARTITION BY context ORDER BY snapshot_at DESC) AS rn
      FROM context_snapshots
      WHERE bot = $1 AND source_id = '*'
    ),
    sources AS (
      SELECT context, count(DISTINCT source_id)::int AS src_count, max(snapshot_at) AS last_snap
      FROM context_snapshots
      WHERE bot = $1 AND source_id <> '*'
      GROUP BY context
    )
    SELECT r.context, r.snapshot_at, r.doc_count, r.rn,
           COALESCE(s.src_count, 0) AS source_count,
           s.last_snap
    FROM recent r LEFT JOIN sources s ON s.context = r.context
    WHERE r.rn <= $2
    ORDER BY r.context, r.rn DESC
  `;
  const { rows } = await pool.query(sql, [bot, SPARKLINE_WINDOW]);

  const byContext = new Map();
  for (const row of rows) {
    const list = byContext.get(row.context) || [];
    list.push(row);
    byContext.set(row.context, list);
  }

  const result = [];
  for (const [context, list] of byContext) {
    list.sort((a, b) => new Date(a.snapshot_at) - new Date(b.snapshot_at));
    const sparkline = list.map((r) => ({
      at: r.snapshot_at.toISOString ? r.snapshot_at.toISOString() : r.snapshot_at,
      count: r.doc_count,
    }));
    const current = list[list.length - 1];
    const prev = list.length >= 2 ? list[list.length - 2] : null;
    result.push({
      context,
      doc_count: current.doc_count,
      prev_count: prev ? prev.doc_count : null,
      sparkline,
      last_synced_at: current.snapshot_at,
      source_count: current.source_count,
      drift_alert: prev ? current.doc_count < prev.doc_count : false,
    });
  }
  result.sort((a, b) => b.doc_count - a.doc_count);
  return result;
}

module.exports = { getContextStats };
