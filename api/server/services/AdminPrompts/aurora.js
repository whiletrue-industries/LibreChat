'use strict';

const { Pool } = require('pg');

let _pool = null;

function getPool() {
  if (_pool) return _pool;
  let url = process.env.DATABASE_URL;
  if (!url && process.env.DB_HOST) {
    const u = encodeURIComponent(process.env.DB_USER || '');
    const p = encodeURIComponent(process.env.DB_PASSWORD || '');
    url = `postgresql://${u}:${p}@${process.env.DB_HOST}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || 'botnim_staging'}`;
  }
  if (!url) {
    throw new Error('Aurora-backed AdminPrompts requires DB_HOST/etc env vars or DATABASE_URL');
  }
  _pool = new Pool({ connectionString: url });
  return _pool;
}

function _resetPoolForTesting() {
  if (_pool) {
    _pool.end().catch(() => {});
  }
  _pool = null;
}

// Returns the active row per (agent_type, section_key), falling back to
// the latest draft when no active row exists for a section.
async function listSections(agentType) {
  const pool = getPool();
  const { rows } = await pool.query(
    `WITH latest AS (
       SELECT DISTINCT ON (section_key) *
       FROM agent_prompts
       WHERE agent_type = $1
       ORDER BY section_key, active DESC, created_at DESC
     )
     SELECT * FROM latest ORDER BY ordinal ASC`,
    [agentType],
  );
  return rows;
}

// All versions for (agent_type, section_key) ordered newest first.
async function listVersions({ agentType, sectionKey }) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM agent_prompts
     WHERE agent_type = $1 AND section_key = $2
     ORDER BY created_at DESC`,
    [agentType, sectionKey],
  );
  return rows;
}

// Insert a draft row inheriting ordinal/header_text from the active row.
async function saveDraft({ agentType, sectionKey, body, changeNote, createdBy }) {
  const pool = getPool();
  const { rows: active } = await pool.query(
    `SELECT * FROM agent_prompts
     WHERE agent_type = $1 AND section_key = $2 AND active = true
     LIMIT 1`,
    [agentType, sectionKey],
  );
  if (active.length === 0) {
    throw new Error(`no active section: ${agentType}/${sectionKey}`);
  }
  const src = active[0];
  const { rows } = await pool.query(
    `INSERT INTO agent_prompts
       (agent_type, section_key, ordinal, header_text, body,
        active, is_draft, parent_version_id, change_note, created_by)
     VALUES ($1, $2, $3, $4, $5, false, true, $6, $7, $8)
     RETURNING *`,
    [agentType, sectionKey, src.ordinal, src.header_text, body, src.id, changeNote, createdBy],
  );
  return rows[0];
}

// Transactionally demote the current active row and promote the draft.
// Throws with "stale parent" if parentVersionId no longer matches active.id.
async function publish({ agentType, sectionKey, draftId, parentVersionId }) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const demote = await client.query(
      `UPDATE agent_prompts SET active = false
       WHERE id = $1 AND active = true
       RETURNING id`,
      [parentVersionId],
    );
    if (demote.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new Error('stale parent: parentVersionId is no longer the active row');
    }
    const { rows } = await client.query(
      `UPDATE agent_prompts
       SET active = true, is_draft = false, published_at = now()
       WHERE id = $1
       RETURNING *`,
      [draftId],
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Restore a named version: copy it into a new active row.
async function restore({ agentType, sectionKey, versionId }) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: target } = await client.query(
      `SELECT * FROM agent_prompts WHERE id = $1 LIMIT 1`,
      [versionId],
    );
    if (target.length === 0) {
      await client.query('ROLLBACK');
      throw new Error(`version not found: ${versionId}`);
    }
    const ver = target[0];
    if (ver.agent_type !== agentType || ver.section_key !== sectionKey) {
      await client.query('ROLLBACK');
      throw new Error(
        `version ${versionId} does not match ${agentType}/${sectionKey}`,
      );
    }
    // Demote current active (if any) and capture its id for parent linkage.
    const { rows: demoted } = await client.query(
      `UPDATE agent_prompts SET active = false
       WHERE agent_type = $1 AND section_key = $2 AND active = true
       RETURNING id`,
      [agentType, sectionKey],
    );
    const parentVersionId = demoted.length > 0 ? demoted[0].id : null;
    const { rows } = await client.query(
      `INSERT INTO agent_prompts
         (agent_type, section_key, ordinal, header_text, body,
          active, is_draft, parent_version_id, published_at)
       VALUES ($1, $2, $3, $4, $5, true, false, $6, now())
       RETURNING *`,
      [agentType, sectionKey, ver.ordinal, ver.header_text, ver.body, parentVersionId],
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Returns enabled test questions ordered by ordinal.
async function getTestQuestions(agentType) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM agent_prompt_test_questions
     WHERE agent_type = $1 AND enabled = true
     ORDER BY ordinal ASC`,
    [agentType],
  );
  return rows;
}

// Replace all test questions for the agent in a single transaction.
async function putTestQuestions({ agentType, questions, createdBy }) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM agent_prompt_test_questions WHERE agent_type = $1`,
      [agentType],
    );
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      await client.query(
        `INSERT INTO agent_prompt_test_questions
           (agent_type, text, ordinal, enabled, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [agentType, q.text, q.ordinal ?? i, q.enabled ?? true, createdBy ?? null],
      );
    }
    await client.query('COMMIT');
    return { ok: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Returns the time window during which a version was active.
// windowStart = COALESCE(published_at, created_at) of the target version.
// windowEnd   = published_at of the next published version after windowStart.
async function getVersionUsage({ agentType, sectionKey, versionId }) {
  const pool = getPool();
  const { rows: target } = await pool.query(
    `SELECT * FROM agent_prompts WHERE id = $1 LIMIT 1`,
    [versionId],
  );
  if (target.length === 0) {
    throw new Error(`version not found: ${versionId}`);
  }
  const ver = target[0];
  if (ver.agent_type !== agentType || ver.section_key !== sectionKey) {
    throw new Error(
      `version ${versionId} does not match ${agentType}/${sectionKey}`,
    );
  }
  const windowStart = ver.published_at || ver.created_at;
  const { rows: next } = await pool.query(
    `SELECT published_at FROM agent_prompts
     WHERE agent_type = $1
       AND section_key = $2
       AND is_draft = false
       AND published_at > $3
     ORDER BY published_at ASC
     LIMIT 1`,
    [agentType, sectionKey, windowStart],
  );
  const windowEnd = next.length > 0 ? next[0].published_at : null;
  return { windowStart, windowEnd, version: ver };
}

module.exports = {
  listSections,
  listVersions,
  saveDraft,
  publish,
  restore,
  getTestQuestions,
  putTestQuestions,
  getVersionUsage,
  getPool,
  _resetPoolForTesting,
};
