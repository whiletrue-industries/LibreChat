'use strict';

const { Pool } = require('pg');

let _pool = null;
function defaultPool() {
  if (_pool) return _pool;
  let url = process.env.DATABASE_URL;
  if (!url && process.env.DB_HOST) {
    const u = encodeURIComponent(process.env.DB_USER || '');
    const p = encodeURIComponent(process.env.DB_PASSWORD || '');
    url = `postgresql://${u}:${p}@${process.env.DB_HOST}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'botnim_staging'}`;
  }
  if (!url) {
    throw new Error('Aurora-backed AdminSanity requires DB_HOST/etc env vars or DATABASE_URL');
  }
  _pool = new Pool({ connectionString: url, max: 4 });
  return _pool;
}

const ENV = process.env.SANITY_DASHBOARD_ENV || (process.env.ENVIRONMENT === 'production' ? 'prod' : 'staging');

async function listRuns({ limit = 100, pool = defaultPool() } = {}) {
  const sql = `
    SELECT id, env, started_at, finished_at, status,
           total_rows, ab_new_wins, ab_old_wins, ab_ties,
           rubric_pass, rubric_fail, rubric_xfail, rubric_infra,
           pass_rate, alert_severity, alert_reasons
    FROM sanity_runs
    WHERE env = $1
    ORDER BY started_at DESC
    LIMIT $2
  `;
  const { rows } = await pool.query(sql, [ENV, limit]);
  return rows.map((r) => ({
    id: r.id,
    env: r.env,
    started_at: r.started_at,
    finished_at: r.finished_at,
    status: r.status,
    total_rows: r.total_rows,
    ab_new_wins: r.ab_new_wins,
    ab_old_wins: r.ab_old_wins,
    ab_ties: r.ab_ties,
    rubric_pass: r.rubric_pass,
    rubric_fail: r.rubric_fail,
    rubric_xfail: r.rubric_xfail,
    rubric_infra: r.rubric_infra,
    pass_rate: r.pass_rate == null ? null : Number(r.pass_rate),
    alert_severity: r.alert_severity,
    alert_reasons: r.alert_reasons || [],
  }));
}

async function getRunHtml(runId, { pool = defaultPool() } = {}) {
  const { rows } = await pool.query(
    'SELECT html, started_at FROM sanity_runs WHERE id = $1 AND env = $2',
    [runId, ENV],
  );
  if (rows.length === 0 || rows[0].html == null) {
    const err = new Error('not_found');
    err.code = 'not_found';
    throw err;
  }
  return { html: rows[0].html, started_at: rows[0].started_at };
}

module.exports = { listRuns, getRunHtml };
