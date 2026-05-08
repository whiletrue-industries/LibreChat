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

// Returns rows from the agent_prompt_snapshots view, newest first.
async function listSnapshots(agentType, limit = 200) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT agent_type, snapshot_minute, section_version_ids, section_keys, published_by
     FROM agent_prompt_snapshots
     WHERE agent_type = $1
     ORDER BY snapshot_minute DESC
     LIMIT $2`,
    [agentType, limit],
  );
  return rows;
}

// Returns all draft rows for an agent (newest first per section_key) plus
// the current active row id for each (so the caller can pass parent_version_id
// at publish time).
async function listAllDrafts(agentType) {
  const pool = getPool();
  const { rows: drafts } = await pool.query(
    `SELECT DISTINCT ON (section_key) *
     FROM agent_prompts
     WHERE agent_type = $1 AND is_draft = true
     ORDER BY section_key, created_at DESC`,
    [agentType],
  );
  const { rows: actives } = await pool.query(
    `SELECT section_key, id AS active_id
     FROM agent_prompts
     WHERE agent_type = $1 AND active = true`,
    [agentType],
  );
  const activeBySection = new Map();
  for (const a of actives) {
    activeBySection.set(a.section_key, a.active_id);
  }
  return drafts.map((d) => ({
    draft: d,
    parentVersionId: activeBySection.get(d.section_key) || null,
  }));
}

// Publish a set of draft rows atomically. `items` is an array of
// `{draftId, parentVersionId, sectionKey}`. Either every section flips
// or none do.
async function publishAllDrafts({ agentType, items }) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const results = [];
    for (const item of items) {
      if (item.parentVersionId) {
        const demote = await client.query(
          `UPDATE agent_prompts SET active = false
           WHERE id = $1 AND active = true AND agent_type = $2 AND section_key = $3
           RETURNING id`,
          [item.parentVersionId, agentType, item.sectionKey],
        );
        if (demote.rowCount === 0) {
          await client.query('ROLLBACK');
          throw new Error(
            `stale parent for section ${item.sectionKey}: ${item.parentVersionId}`,
          );
        }
      }
      const { rows } = await client.query(
        `UPDATE agent_prompts
         SET active = true, is_draft = false, published_at = now()
         WHERE id = $1 AND agent_type = $2 AND section_key = $3
         RETURNING *`,
        [item.draftId, agentType, item.sectionKey],
      );
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        throw new Error(`draft not found for section ${item.sectionKey}: ${item.draftId}`);
      }
      results.push(rows[0]);
    }
    await client.query('COMMIT');
    return results;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Restore an entire snapshot in one transaction: for each version id,
// demote the current active row in that section and insert a copy of the
// named version as the new active row. Either all sections flip or none.
async function restoreSnapshotMinute({ agentType, sectionVersionIds }) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const results = [];
    for (const versionId of sectionVersionIds) {
      const { rows: target } = await client.query(
        `SELECT * FROM agent_prompts WHERE id = $1 LIMIT 1`,
        [versionId],
      );
      if (target.length === 0) {
        await client.query('ROLLBACK');
        throw new Error(`version not found: ${versionId}`);
      }
      const ver = target[0];
      if (ver.agent_type !== agentType) {
        await client.query('ROLLBACK');
        throw new Error(`version ${versionId} does not belong to agent ${agentType}`);
      }
      const { rows: demoted } = await client.query(
        `UPDATE agent_prompts SET active = false
         WHERE agent_type = $1 AND section_key = $2 AND active = true
         RETURNING id`,
        [agentType, ver.section_key],
      );
      const parentVersionId = demoted.length > 0 ? demoted[0].id : null;
      const { rows } = await client.query(
        `INSERT INTO agent_prompts
           (agent_type, section_key, ordinal, header_text, body,
            active, is_draft, parent_version_id, published_at)
         VALUES ($1, $2, $3, $4, $5, true, false, $6, now())
         RETURNING *`,
        [agentType, ver.section_key, ver.ordinal, ver.header_text, ver.body, parentVersionId],
      );
      results.push(rows[0]);
    }
    await client.query('COMMIT');
    return results;
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

// Return the would-be-active sections per (agent_type, section_key): for each
// section_key prefer the newest is_draft=true row, otherwise fall back to the
// active=true row. Used by the draft-Agent mirror so admins can chat with the
// in-flight draft text. Rows shaped identically to listSections().
async function listLatestDraftOrActiveSections(agentType) {
  const pool = getPool();
  const { rows: active } = await pool.query(
    `SELECT * FROM agent_prompts
     WHERE agent_type = $1 AND active = true`,
    [agentType],
  );
  const { rows: drafts } = await pool.query(
    `SELECT DISTINCT ON (section_key) *
     FROM agent_prompts
     WHERE agent_type = $1 AND is_draft = true
     ORDER BY section_key, created_at DESC`,
    [agentType],
  );
  const draftBySection = new Map(drafts.map((d) => [d.section_key, d]));
  const merged = active.map((a) => draftBySection.get(a.section_key) || a);
  merged.sort((x, y) => x.ordinal - y.ordinal);
  return merged;
}

module.exports = {
  listSections,
  listVersions,
  saveDraft,
  publish,
  restore,
  listSnapshots,
  listAllDrafts,
  publishAllDrafts,
  restoreSnapshotMinute,
  listLatestDraftOrActiveSections,
  getTestQuestions,
  putTestQuestions,
  getVersionUsage,
  getPool,
  _resetPoolForTesting,
};
