const { Pool } = require('pg');
const { getContextStats, getSourceStats } = require('../aurora');

const PG_URL = process.env.TEST_AURORA_URL ||
  'postgresql://test:test@localhost:54329/lc_admin_sources_test';

describe('getContextStats', () => {
  let pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL });
    await pool.query(`
      DROP TABLE IF EXISTS documents;
      DROP TABLE IF EXISTS contexts;
      DROP TABLE IF EXISTS context_snapshots;
      CREATE TABLE context_snapshots (
        id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        snapshot_at TIMESTAMPTZ NOT NULL,
        bot TEXT NOT NULL,
        context TEXT NOT NULL,
        source_id TEXT NOT NULL,
        doc_count INTEGER NOT NULL
      );
      CREATE TABLE contexts (
        id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        bot TEXT NOT NULL,
        name TEXT NOT NULL
      );
      CREATE TABLE documents (
        id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        context_id UUID NOT NULL REFERENCES contexts(id),
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb
      );
    `);
  });
  afterAll(async () => { await pool.end(); });

  beforeEach(async () => {
    await pool.query('TRUNCATE documents, contexts, context_snapshots');
  });

  it('returns one row per context with current/prev counts and sparkline', async () => {
    const insert = (at, ctx, src, n) => pool.query(
      `INSERT INTO context_snapshots (snapshot_at, bot, context, source_id, doc_count)
       VALUES ($1, 'unified', $2, $3, $4)`, [at, ctx, src, n]);
    await insert('2026-04-25', 'legal_text', '*', 488);
    await insert('2026-04-26', 'legal_text', '*', 488);
    await insert('2026-04-27', 'legal_text', '*', 480);  // drift
    await insert('2026-04-27', 'legal_text', 'חוק_הכנסת', 100);
    await insert('2026-04-27', 'ethics_decisions', '*', 273);

    const { rows: legalCtxRows } = await pool.query(
      "INSERT INTO contexts (bot, name) VALUES ('unified', 'legal_text') RETURNING id");
    const legalCtxId = legalCtxRows[0].id;
    await pool.query(
      `INSERT INTO documents (context_id, metadata)
       SELECT $1, jsonb_build_object('title', 'doc-' || g) FROM generate_series(1, 3) g`,
      [legalCtxId]);
    // Two chunks share a title, so document_count < chunk count.
    await pool.query(
      `INSERT INTO documents (context_id, metadata)
       VALUES ($1, jsonb_build_object('title', 'doc-1'))`,
      [legalCtxId]);

    const stats = await getContextStats('unified', { pool });
    expect(stats).toHaveLength(2);
    const legal = stats.find((s) => s.context === 'legal_text');
    expect(legal.doc_count).toBe(480);
    expect(legal.prev_count).toBe(488);
    expect(legal.drift_alert).toBe(true);
    expect(legal.sparkline.map((p) => p.count)).toEqual([488, 488, 480]);
    expect(legal.document_count).toBe(3);  // distinct titles in `documents`

    const eth = stats.find((s) => s.context === 'ethics_decisions');
    expect(eth.drift_alert).toBe(false);
    expect(eth.prev_count).toBeNull();
    expect(eth.document_count).toBe(0);  // no documents seeded
  });

  it('returns empty array when no snapshots exist', async () => {
    const stats = await getContextStats('unified', { pool });
    expect(stats).toEqual([]);
  });
});

describe('getSourceStats', () => {
  let pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL });
  });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => { await pool.query('TRUNCATE context_snapshots'); });

  it('returns per-source breakdown plus context_summary for the latest snapshot', async () => {
    const insert = (at, ctx, src, n) => pool.query(
      `INSERT INTO context_snapshots (snapshot_at, bot, context, source_id, doc_count)
       VALUES ($1, 'unified', $2, $3, $4)`, [at, ctx, src, n]);
    await insert('2026-04-20', 'legal_text', '*', 480);
    await insert('2026-04-20', 'legal_text', 'חוק_הכנסת', 100);
    await insert('2026-04-20', 'legal_text', 'תקנון_הכנסת', 280);
    await insert('2026-04-27', 'legal_text', '*', 488);
    await insert('2026-04-27', 'legal_text', 'חוק_הכנסת', 105);  // +5 vs 7d
    await insert('2026-04-27', 'legal_text', 'תקנון_הכנסת', 283);  // +3 vs 7d

    const out = await getSourceStats('unified', 'legal_text', { pool });
    expect(out.context_summary.doc_count).toBe(488);
    expect(out.sources).toHaveLength(2);
    const ch = out.sources.find((s) => s.source_id === 'חוק_הכנסת');
    expect(ch.doc_count).toBe(105);
    expect(ch.delta_7d).toBe(5);
    expect(ch.sparkline.map((p) => p.count)).toEqual([100, 105]);
  });
});
