'use strict';

const { Client } = require('pg');
const auroraAdapter = require('../server/services/AdminPrompts/aurora');

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:54330/librechat_test';

describe('AdminPrompts/aurora', () => {
  let client;

  beforeAll(async () => {
    client = new Client({ connectionString: TEST_DB_URL });
    await client.connect();
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_prompts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_type text NOT NULL,
        section_key text NOT NULL,
        ordinal int NOT NULL DEFAULT 0,
        header_text text NOT NULL DEFAULT '',
        body text NOT NULL,
        active boolean NOT NULL DEFAULT false,
        is_draft boolean NOT NULL DEFAULT true,
        parent_version_id uuid,
        change_note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by text,
        published_at timestamptz
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS active_by_agent_section
      ON agent_prompts (agent_type, section_key) WHERE active = true
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_prompt_test_questions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_type text NOT NULL,
        text text NOT NULL,
        ordinal int NOT NULL DEFAULT 0,
        enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        created_by text
      )
    `);
    process.env.DATABASE_URL = TEST_DB_URL;
  });

  afterAll(async () => {
    await client.query('TRUNCATE agent_prompts, agent_prompt_test_questions');
    await client.end();
    auroraAdapter._resetPoolForTesting();
  });

  beforeEach(async () => {
    await client.query('TRUNCATE agent_prompts, agent_prompt_test_questions');
    auroraAdapter._resetPoolForTesting();
  });

  // ── helpers ────────────────────────────────────────────────────────────────

  async function seedActive({ agentType = 'unified', sectionKey = 'intro', ordinal = 0, body = 'hello world', header_text = 'Intro' } = {}) {
    const { rows } = await client.query(
      `INSERT INTO agent_prompts
         (agent_type, section_key, ordinal, header_text, body, active, is_draft, published_at)
       VALUES ($1, $2, $3, $4, $5, true, false, now())
       RETURNING *`,
      [agentType, sectionKey, ordinal, header_text, body],
    );
    return rows[0];
  }

  async function seedDraft({ agentType = 'unified', sectionKey = 'intro', body = 'draft body', parentId = null } = {}) {
    const { rows } = await client.query(
      `INSERT INTO agent_prompts
         (agent_type, section_key, ordinal, header_text, body, active, is_draft, parent_version_id)
       VALUES ($1, $2, 0, 'Intro', $3, false, true, $4)
       RETURNING *`,
      [agentType, sectionKey, body, parentId],
    );
    return rows[0];
  }

  // ── tests ──────────────────────────────────────────────────────────────────

  it('1. listSections returns active rows ordered by ordinal', async () => {
    await seedActive({ sectionKey: 'rules', ordinal: 1, body: 'rules body' });
    await seedActive({ sectionKey: 'intro', ordinal: 0, body: 'intro body' });

    const rows = await auroraAdapter.listSections('unified');
    expect(rows).toHaveLength(2);
    expect(rows[0].section_key).toBe('intro');
    expect(rows[0].ordinal).toBe(0);
    expect(rows[1].section_key).toBe('rules');
    expect(rows[1].ordinal).toBe(1);
    expect(rows[0].active).toBe(true);
  });

  it('2. listSections falls back to latest draft when section has no active version', async () => {
    // Only a draft exists for 'orphan' section — no active row.
    await client.query(
      `INSERT INTO agent_prompts
         (agent_type, section_key, ordinal, header_text, body, active, is_draft)
       VALUES ('unified', 'orphan', 5, 'Orphan', 'draft only', false, true)`,
    );

    const rows = await auroraAdapter.listSections('unified');
    expect(rows).toHaveLength(1);
    expect(rows[0].section_key).toBe('orphan');
    expect(rows[0].active).toBe(false);
    expect(rows[0].is_draft).toBe(true);
  });

  it('3. listVersions returns history descending', async () => {
    await client.query(
      `INSERT INTO agent_prompts
         (agent_type, section_key, ordinal, header_text, body, active, is_draft, created_at)
       VALUES
         ('unified', 'intro', 0, 'H', 'old body',     false, false, '2026-01-01T00:00:00Z'),
         ('unified', 'intro', 0, 'H', 'newer body',   false, false, '2026-03-01T00:00:00Z'),
         ('unified', 'intro', 0, 'H', 'current body', true,  false, '2026-04-01T00:00:00Z')`,
    );

    const rows = await auroraAdapter.listVersions({ agentType: 'unified', sectionKey: 'intro' });
    expect(rows).toHaveLength(3);
    expect(rows[0].body).toBe('current body');
    expect(rows[1].body).toBe('newer body');
    expect(rows[2].body).toBe('old body');
  });

  it('4. saveDraft inherits ordinal/header_text from active and links parent_version_id', async () => {
    const active = await seedActive({ ordinal: 3, header_text: 'My Header', body: 'original' });

    const draft = await auroraAdapter.saveDraft({
      agentType: 'unified',
      sectionKey: 'intro',
      body: 'draft body here',
      changeNote: 'tweaking intro',
      createdBy: 'user-1',
    });

    expect(draft.active).toBe(false);
    expect(draft.is_draft).toBe(true);
    expect(draft.ordinal).toBe(3);
    expect(draft.header_text).toBe('My Header');
    expect(draft.body).toBe('draft body here');
    expect(draft.parent_version_id).toBe(active.id);
    expect(draft.change_note).toBe('tweaking intro');
    expect(draft.created_by).toBe('user-1');
  });

  it('5. saveDraft throws "no active section" when none exists', async () => {
    await expect(
      auroraAdapter.saveDraft({
        agentType: 'unified',
        sectionKey: 'nonexistent',
        body: 'irrelevant',
        changeNote: 'n',
        createdBy: 'user-1',
      }),
    ).rejects.toThrow(/no active section/i);
  });

  it('6. publish demotes current and promotes draft transactionally', async () => {
    const active = await seedActive({ body: 'original active' });
    const draft = await seedDraft({ body: 'new published body', parentId: active.id });

    const promoted = await auroraAdapter.publish({
      agentType: 'unified',
      sectionKey: 'intro',
      draftId: draft.id,
      parentVersionId: active.id,
    });

    expect(promoted.id).toBe(draft.id);
    expect(promoted.active).toBe(true);
    expect(promoted.is_draft).toBe(false);
    expect(promoted.published_at).toBeTruthy();

    // Old active row should be demoted.
    const { rows } = await client.query(
      `SELECT active FROM agent_prompts WHERE id = $1`,
      [active.id],
    );
    expect(rows[0].active).toBe(false);
  });

  it('7. publish throws "stale parent" when parentVersionId no longer matches active.id', async () => {
    const active = await seedActive({ body: 'current active' });
    const draft = await seedDraft({ body: 'new body', parentId: active.id });

    // Manually demote the active row so the parentVersionId is stale.
    await client.query(
      `UPDATE agent_prompts SET active = false WHERE id = $1`,
      [active.id],
    );

    await expect(
      auroraAdapter.publish({
        agentType: 'unified',
        sectionKey: 'intro',
        draftId: draft.id,
        parentVersionId: active.id,
      }),
    ).rejects.toThrow(/stale parent/i);
  });

  it('8. restore creates a new active row that copies the named version', async () => {
    const active = await seedActive({ body: 'original text', header_text: 'Intro Header', ordinal: 2 });

    const restored = await auroraAdapter.restore({
      agentType: 'unified',
      sectionKey: 'intro',
      versionId: active.id,
    });

    // The returned row is a new INSERT, not the original.
    expect(restored.id).not.toBe(active.id);
    expect(restored.body).toBe('original text');
    expect(restored.header_text).toBe('Intro Header');
    expect(restored.ordinal).toBe(2);
    expect(restored.active).toBe(true);
    expect(restored.is_draft).toBe(false);
    expect(restored.published_at).toBeTruthy();

    // The original active row should now be demoted.
    const { rows } = await client.query(
      `SELECT active FROM agent_prompts WHERE id = $1`,
      [active.id],
    );
    expect(rows[0].active).toBe(false);
  });

  it('9. getTestQuestions returns enabled rows ordered by ordinal', async () => {
    await client.query(
      `INSERT INTO agent_prompt_test_questions
         (agent_type, text, ordinal, enabled)
       VALUES
         ('unified', 'q disabled', 0, false),
         ('unified', 'q third',    3, true),
         ('unified', 'q first',    1, true),
         ('unified', 'q second',   2, true)`,
    );

    const rows = await auroraAdapter.getTestQuestions('unified');
    expect(rows).toHaveLength(3);
    expect(rows[0].text).toBe('q first');
    expect(rows[1].text).toBe('q second');
    expect(rows[2].text).toBe('q third');
  });

  it('10. putTestQuestions replaces all rows in a single transaction', async () => {
    // Pre-seed some old rows to verify they get wiped.
    await client.query(
      `INSERT INTO agent_prompt_test_questions (agent_type, text, ordinal, enabled)
       VALUES ('unified', 'old q', 0, true)`,
    );

    const result = await auroraAdapter.putTestQuestions({
      agentType: 'unified',
      questions: [
        { text: 'brand new q1', ordinal: 0, enabled: true },
        { text: 'brand new q2', ordinal: 1, enabled: false },
      ],
      createdBy: 'admin',
    });

    expect(result).toEqual({ ok: true });

    const { rows } = await client.query(
      `SELECT text, ordinal, enabled FROM agent_prompt_test_questions
       WHERE agent_type = 'unified' ORDER BY ordinal`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].text).toBe('brand new q1');
    expect(rows[1].text).toBe('brand new q2');
    expect(rows[1].enabled).toBe(false);
  });

  it('11. getVersionUsage returns windowStart/windowEnd for an active+next-published version', async () => {
    // Insert two published versions with known timestamps.
    const { rows: r1 } = await client.query(
      `INSERT INTO agent_prompts
         (agent_type, section_key, ordinal, header_text, body, active, is_draft, published_at, created_at)
       VALUES ('unified', 'intro', 0, 'H', 'v1 body', false, false, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
       RETURNING *`,
    );
    const { rows: r2 } = await client.query(
      `INSERT INTO agent_prompts
         (agent_type, section_key, ordinal, header_text, body, active, is_draft, published_at, created_at)
       VALUES ('unified', 'intro', 0, 'H', 'v2 body', true, false, '2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z')
       RETURNING *`,
    );

    const v1 = r1[0];
    const v2 = r2[0];

    const usage = await auroraAdapter.getVersionUsage({
      agentType: 'unified',
      sectionKey: 'intro',
      versionId: v1.id,
    });

    expect(usage.version.id).toBe(v1.id);
    expect(new Date(usage.windowStart).toISOString()).toBe('2026-01-01T00:00:00.000Z');
    // windowEnd is v2.published_at (the next published after v1's windowStart).
    expect(new Date(usage.windowEnd).toISOString()).toBe('2026-03-01T00:00:00.000Z');
    // Querying v2 should have null windowEnd (no later published version).
    const usage2 = await auroraAdapter.getVersionUsage({
      agentType: 'unified',
      sectionKey: 'intro',
      versionId: v2.id,
    });
    expect(usage2.windowEnd).toBeNull();
  });

  it('12. getVersionUsage throws when versionId does not exist or mismatches agentType/sectionKey', async () => {
    // Non-existent UUID.
    await expect(
      auroraAdapter.getVersionUsage({
        agentType: 'unified',
        sectionKey: 'intro',
        versionId: '00000000-0000-0000-0000-000000000001',
      }),
    ).rejects.toThrow(/not found/i);

    // Exists but belongs to a different section.
    const { rows } = await client.query(
      `INSERT INTO agent_prompts
         (agent_type, section_key, ordinal, header_text, body, active, is_draft)
       VALUES ('unified', 'rules', 0, 'R', 'rules body', true, false)
       RETURNING id`,
    );
    const rulesId = rows[0].id;

    await expect(
      auroraAdapter.getVersionUsage({
        agentType: 'unified',
        sectionKey: 'intro',
        versionId: rulesId,
      }),
    ).rejects.toThrow(/does not match/i);
  });
});
