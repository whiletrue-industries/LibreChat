'use strict';

const { Client } = require('pg');
const auroraAdapter = require('./aurora');

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://test:test@localhost:54330/librechat_test';

describe('AdminPrompts/aurora tool overrides', () => {
  let client;

  beforeAll(async () => {
    client = new Client({ connectionString: TEST_DB_URL });
    await client.connect();
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_tool_overrides (
        id                BIGSERIAL PRIMARY KEY,
        agent_type        TEXT NOT NULL,
        tool_name         TEXT NOT NULL,
        description       TEXT NOT NULL,
        active            BOOLEAN NOT NULL DEFAULT false,
        is_draft          BOOLEAN NOT NULL DEFAULT false,
        parent_version_id BIGINT REFERENCES agent_tool_overrides(id),
        change_note       TEXT,
        created_by        TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        published_at      TIMESTAMPTZ
      )
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS agent_tool_overrides_active_uniq
        ON agent_tool_overrides (agent_type, tool_name)
        WHERE active = true
    `);
    process.env.DATABASE_URL = TEST_DB_URL;
  });

  afterAll(async () => {
    await client.query('TRUNCATE agent_tool_overrides RESTART IDENTITY');
    await client.end();
    auroraAdapter._resetPoolForTesting();
  });

  beforeEach(async () => {
    await client.query('TRUNCATE agent_tool_overrides RESTART IDENTITY');
    auroraAdapter._resetPoolForTesting();
  });

  // ── helpers ────────────────────────────────────────────────────────────────

  async function seedActive({
    agentType = 'unified',
    toolName = 'search_unified__legal_text',
    description = 'overridden description',
  } = {}) {
    const { rows } = await client.query(
      `INSERT INTO agent_tool_overrides
         (agent_type, tool_name, description, active, is_draft, published_at)
       VALUES ($1, $2, $3, true, false, now())
       RETURNING *`,
      [agentType, toolName, description],
    );
    return rows[0];
  }

  async function seedDraft({
    agentType = 'unified',
    toolName = 'search_unified__legal_text',
    description = 'draft description',
    parentId = null,
  } = {}) {
    const { rows } = await client.query(
      `INSERT INTO agent_tool_overrides
         (agent_type, tool_name, description, active, is_draft, parent_version_id)
       VALUES ($1, $2, $3, false, true, $4)
       RETURNING *`,
      [agentType, toolName, description, parentId],
    );
    return rows[0];
  }

  // ── tests ──────────────────────────────────────────────────────────────────

  it('1. listToolOverrides merges canonical tools with active overrides', async () => {
    await seedActive({
      toolName: 'search_unified__legal_text',
      description: 'overridden legal_text desc',
    });

    const canonicalTools = {
      search_unified__legal_text: 'canonical legal_text desc',
      search_unified__common_knowledge: 'canonical common_knowledge desc',
    };

    const rows = await auroraAdapter.listToolOverrides('unified', canonicalTools);

    expect(rows).toHaveLength(2);
    const byName = Object.fromEntries(rows.map((r) => [r.toolName, r]));

    expect(byName['search_unified__legal_text'].defaultDescription).toBe(
      'canonical legal_text desc',
    );
    expect(byName['search_unified__legal_text'].override).toMatchObject({
      description: 'overridden legal_text desc',
    });
    expect(byName['search_unified__legal_text'].override.id).toBeTruthy();

    expect(byName['search_unified__common_knowledge'].defaultDescription).toBe(
      'canonical common_knowledge desc',
    );
    expect(byName['search_unified__common_knowledge'].override).toBeNull();
  });

  it('2. listToolOverrides ignores draft rows when computing the active override', async () => {
    const active = await seedActive({
      toolName: 'search_unified__legal_text',
      description: 'currently active',
    });
    await seedDraft({
      toolName: 'search_unified__legal_text',
      description: 'unpublished draft',
      parentId: active.id,
    });

    const rows = await auroraAdapter.listToolOverrides('unified', {
      search_unified__legal_text: 'canonical',
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].override.description).toBe('currently active');
  });

  it('3. listToolOverrideVersions returns history newest first', async () => {
    await client.query(
      `INSERT INTO agent_tool_overrides
         (agent_type, tool_name, description, active, is_draft, created_at)
       VALUES
         ('unified', 'search_unified__legal_text', 'old desc',     false, false, '2026-01-01T00:00:00Z'),
         ('unified', 'search_unified__legal_text', 'newer desc',   false, false, '2026-03-01T00:00:00Z'),
         ('unified', 'search_unified__legal_text', 'current desc', true,  false, '2026-04-01T00:00:00Z')`,
    );

    const rows = await auroraAdapter.listToolOverrideVersions({
      agentType: 'unified',
      toolName: 'search_unified__legal_text',
    });

    expect(rows).toHaveLength(3);
    expect(rows[0].description).toBe('current desc');
    expect(rows[1].description).toBe('newer desc');
    expect(rows[2].description).toBe('old desc');
  });

  it('4. saveToolOverrideDraft creates a draft row with active=false, is_draft=true', async () => {
    const active = await seedActive({ description: 'currently active' });

    const draft = await auroraAdapter.saveToolOverrideDraft({
      agentType: 'unified',
      toolName: 'search_unified__legal_text',
      description: 'new draft body',
      changeNote: 'tweaking tool desc',
      createdBy: 'user-1',
    });

    expect(draft.active).toBe(false);
    expect(draft.is_draft).toBe(true);
    expect(draft.description).toBe('new draft body');
    expect(String(draft.parent_version_id)).toBe(String(active.id));
    expect(draft.change_note).toBe('tweaking tool desc');
    expect(draft.created_by).toBe('user-1');
  });

  it('5. saveToolOverrideDraft works when no active row exists (initial override)', async () => {
    // No prior override row at all — first draft should still be insertable.
    const draft = await auroraAdapter.saveToolOverrideDraft({
      agentType: 'unified',
      toolName: 'search_unified__legal_text',
      description: 'first ever draft',
      changeNote: 'initial override',
      createdBy: 'user-1',
    });

    expect(draft.active).toBe(false);
    expect(draft.is_draft).toBe(true);
    expect(draft.description).toBe('first ever draft');
    expect(draft.parent_version_id).toBeNull();
    expect(draft.created_by).toBe('user-1');
  });

  it('6. publishToolOverride demotes current active and promotes draft transactionally', async () => {
    const active = await seedActive({ description: 'currently active' });
    const draft = await seedDraft({ description: 'new desc to publish', parentId: active.id });

    const promoted = await auroraAdapter.publishToolOverride({
      agentType: 'unified',
      toolName: 'search_unified__legal_text',
      draftId: draft.id,
      parentVersionId: active.id,
    });

    expect(String(promoted.id)).toBe(String(draft.id));
    expect(promoted.active).toBe(true);
    expect(promoted.is_draft).toBe(false);
    expect(promoted.published_at).toBeTruthy();

    const { rows } = await client.query(
      `SELECT active FROM agent_tool_overrides WHERE id = $1`,
      [active.id],
    );
    expect(rows[0].active).toBe(false);
  });

  it('7. publishToolOverride promotes draft cleanly when no prior active row exists', async () => {
    const draft = await seedDraft({ description: 'first publish' });

    const promoted = await auroraAdapter.publishToolOverride({
      agentType: 'unified',
      toolName: 'search_unified__legal_text',
      draftId: draft.id,
      parentVersionId: null,
    });

    expect(String(promoted.id)).toBe(String(draft.id));
    expect(promoted.active).toBe(true);
    expect(promoted.is_draft).toBe(false);
    expect(promoted.published_at).toBeTruthy();
  });

  it('8. publishToolOverride throws "stale parent" when parentVersionId no longer matches active.id', async () => {
    const active = await seedActive({ description: 'currently active' });
    const draft = await seedDraft({ description: 'new desc', parentId: active.id });

    await client.query(
      `UPDATE agent_tool_overrides SET active = false WHERE id = $1`,
      [active.id],
    );

    await expect(
      auroraAdapter.publishToolOverride({
        agentType: 'unified',
        toolName: 'search_unified__legal_text',
        draftId: draft.id,
        parentVersionId: active.id,
      }),
    ).rejects.toThrow(/stale parent/i);
  });

  it('9. restoreToolOverride creates a new active row that copies the named version', async () => {
    const active = await seedActive({ description: 'original desc' });

    const restored = await auroraAdapter.restoreToolOverride({
      agentType: 'unified',
      toolName: 'search_unified__legal_text',
      versionId: active.id,
    });

    expect(String(restored.id)).not.toBe(String(active.id));
    expect(restored.description).toBe('original desc');
    expect(restored.active).toBe(true);
    expect(restored.is_draft).toBe(false);
    expect(restored.published_at).toBeTruthy();

    const { rows } = await client.query(
      `SELECT active FROM agent_tool_overrides WHERE id = $1`,
      [active.id],
    );
    expect(rows[0].active).toBe(false);
  });

  it('10. restoreToolOverride throws when versionId belongs to a different agent_type/tool_name', async () => {
    const { rows } = await client.query(
      `INSERT INTO agent_tool_overrides
         (agent_type, tool_name, description, active, is_draft)
       VALUES ('unified', 'other_tool', 'other desc', true, false)
       RETURNING id`,
    );
    const otherId = rows[0].id;

    await expect(
      auroraAdapter.restoreToolOverride({
        agentType: 'unified',
        toolName: 'search_unified__legal_text',
        versionId: otherId,
      }),
    ).rejects.toThrow(/does not match/i);
  });

  it('11. restoreToolOverride throws when versionId does not exist', async () => {
    await expect(
      auroraAdapter.restoreToolOverride({
        agentType: 'unified',
        toolName: 'search_unified__legal_text',
        versionId: 99999999,
      }),
    ).rejects.toThrow(/not found/i);
  });
});
