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
  //   docs:   count of distinct source documents per context. Prefer
  //           `metadata->>'source_doc'` when present (written by the
  //           rebuilding-bots collect_sources pipeline for CSV-row
  //           contexts that fan one upstream document out into many
  //           chunks — knesset_protocols speaker turns, plenary_schedule
  //           (session, item) pairs). Without source_doc those contexts
  //           would over-count by 10-300x because each chunk has its own
  //           unique `title`. Fall back to `title` for everyone else
  //           (legal_text, government_decisions, etc. — each row IS the
  //           source doc there, so DISTINCT title is correct).
  //           `source_id` is unusable: CSV-backed contexts keep ONE
  //           source_id for the whole CSV, collapsing thousands of docs
  //           to 1.
  const sql = `
    WITH recent AS (
      SELECT context, snapshot_at, doc_count,
             ROW_NUMBER() OVER (PARTITION BY context ORDER BY snapshot_at DESC) AS rn
      FROM context_snapshots
      WHERE bot = $1 AND source_id = '*'
    ),
    docs AS (
      SELECT c.name AS context,
             count(DISTINCT COALESCE(d.metadata->>'source_doc', d.metadata->>'title'))::int AS document_count
      FROM contexts c JOIN documents d ON d.context_id = c.id
      WHERE c.bot = $1 AND (d.metadata ? 'source_doc' OR d.metadata ? 'title')
      GROUP BY c.name
    )
    SELECT r.context, r.snapshot_at, r.doc_count, r.rn,
           COALESCE(docs.document_count, 0) AS document_count
    FROM recent r LEFT JOIN docs ON docs.context = r.context
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
      document_count: current.document_count,
      drift_alert: prev ? current.doc_count < prev.doc_count : false,
    });
  }
  result.sort((a, b) => b.doc_count - a.doc_count);
  return result;
}

async function getSourceStats(bot, context, { pool = defaultPool() } = {}) {
  const aggSql = `
    SELECT snapshot_at, doc_count
    FROM context_snapshots
    WHERE bot = $1 AND context = $2 AND source_id = '*'
    ORDER BY snapshot_at DESC
    LIMIT $3
  `;
  const { rows: aggRows } = await pool.query(aggSql, [bot, context, SPARKLINE_WINDOW]);
  if (aggRows.length === 0) {
    return { context_summary: null, sources: [] };
  }
  const latestAgg = aggRows[0];

  const srcSql = `
    SELECT source_id, snapshot_at, doc_count
    FROM context_snapshots
    WHERE bot = $1 AND context = $2 AND source_id <> '*'
    ORDER BY source_id, snapshot_at DESC
  `;
  const { rows: srcRows } = await pool.query(srcSql, [bot, context]);

  const grouped = new Map();
  for (const row of srcRows) {
    const list = grouped.get(row.source_id) || [];
    list.push(row);
    grouped.set(row.source_id, list);
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const sources = [];
  for (const [source_id, list] of grouped) {
    list.sort((a, b) => new Date(a.snapshot_at) - new Date(b.snapshot_at));
    const sparkline = list.slice(-SPARKLINE_WINDOW).map((r) => ({
      at: r.snapshot_at.toISOString ? r.snapshot_at.toISOString() : r.snapshot_at,
      count: r.doc_count,
    }));
    const current = list[list.length - 1];
    const baseline = list.find((r) => new Date(r.snapshot_at) <= sevenDaysAgo)
      || list[0];
    sources.push({
      source_id,
      doc_count: current.doc_count,
      sparkline,
      delta_7d: current.doc_count - baseline.doc_count,
    });
  }
  sources.sort((a, b) => b.doc_count - a.doc_count);

  return {
    context_summary: {
      context,
      doc_count: latestAgg.doc_count,
      last_synced_at: latestAgg.snapshot_at,
      sparkline: aggRows.slice().reverse().map((r) => ({
        at: r.snapshot_at.toISOString ? r.snapshot_at.toISOString() : r.snapshot_at,
        count: r.doc_count,
      })),
    },
    sources,
  };
}

module.exports = { getContextStats, getSourceStats };
