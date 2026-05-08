/**
 * seed-botnim-agent.js draft-mirror integration.
 *
 * The seed script (LibreChat/scripts/seed-botnim-agent.js) loads
 * api/server/services/AdminPrompts/draftAgent.js and calls
 * composeDraftPayload + ensureDraftAgent under the same Mongo connection
 * as the global-share step. This test mirrors that flow:
 *   1. Stub aurora (same shape the seed actually exposes).
 *   2. Pre-create a canonical Mongo Agent doc the way HTTP POST /api/agents
 *      would (the seed does that step over HTTP, which we cannot exercise
 *      from a unit test, but the resulting Mongo doc is what matters).
 *   3. Invoke composeDraftPayload + ensureDraftAgent twice and assert that
 *      exactly ONE draft Agent doc exists, sharing canonical's actions and
 *      carrying draft=true plus the latest joined-prompt instructions.
 */

'use strict';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

process.env.SEED_AGENT_NAME = 'Test Canonical Bot — Seed';

const mockAuroraStub = {
  listLatestDraftOrActiveSections: jest.fn(),
};
jest.mock('~/server/services/AdminPrompts/aurora', () => mockAuroraStub);

let memServer;
let Agent;
const CANONICAL_NAME = 'Test Canonical Bot — Seed';
const DRAFT_NAME = 'Test Canonical Bot — Seed — DRAFT';

beforeAll(async () => {
  memServer = await MongoMemoryServer.create();
  await mongoose.connect(memServer.getUri());
  ({ Agent } = require('~/db/models'));
});

afterAll(async () => {
  await mongoose.disconnect();
  await memServer.stop();
});

beforeEach(async () => {
  jest.clearAllMocks();
  await Agent.deleteMany({});
  await Agent.create({
    id: 'agent_canonical_seed_test',
    name: CANONICAL_NAME,
    description: 'canonical seeded over HTTP',
    instructions: 'published joined prompt v1',
    provider: 'openAI',
    model: 'gpt-5.4-mini',
    model_parameters: { temperature: 0 },
    tools: ['canonical_tool_a'],
    actions: ['act_seed_1'],
    author: new mongoose.Types.ObjectId(),
    authorName: 'seed',
    category: 'general',
  });
});

function pgRow(overrides = {}) {
  return {
    id: overrides.id || 'sec-id',
    agent_type: overrides.agent_type || 'unified',
    section_key: overrides.section_key || 'intro',
    ordinal: overrides.ordinal ?? 0,
    header_text: overrides.header_text || 'Intro',
    body: overrides.body || 'b',
    active: overrides.active ?? true,
    is_draft: overrides.is_draft ?? false,
    parent_version_id: overrides.parent_version_id || null,
    change_note: overrides.change_note || null,
    created_at: overrides.created_at || new Date('2026-05-01'),
    created_by: overrides.created_by || null,
    published_at: overrides.published_at || new Date('2026-05-01'),
  };
}

describe('seed flow draft mirror', () => {
  const draftAgent = require('~/server/services/AdminPrompts/draftAgent');

  it('first seed call creates a draft mirror sharing canonical actions/tools and draft=true', async () => {
    mockAuroraStub.listLatestDraftOrActiveSections.mockResolvedValue([
      pgRow({ section_key: 'intro', ordinal: 0, body: 'published joined prompt v1' }),
    ]);

    const payload = await draftAgent.composeDraftPayload('unified');
    const draft = await draftAgent.ensureDraftAgent({
      bot: 'unified',
      instructions: payload.instructions,
      Agent,
    });

    expect(draft.name).toBe(DRAFT_NAME);
    expect(draft.draft).toBe(true);
    expect(draft.actions).toEqual(['act_seed_1']);
    expect(draft.tools).toEqual(['canonical_tool_a']);
    expect(draft.instructions).toContain('published joined prompt v1');

    const allDrafts = await Agent.find({ draft: true }).lean();
    expect(allDrafts).toHaveLength(1);
    const allByName = await Agent.find({ name: { $in: [CANONICAL_NAME, DRAFT_NAME] } }).lean();
    expect(allByName).toHaveLength(2);
    const canonical = allByName.find((a) => a.name === CANONICAL_NAME);
    expect(canonical.draft).toBeFalsy();
    expect(canonical.id).not.toBe(draft.id);
  });

  it('second seed call is idempotent — exactly one draft doc, instructions refresh in place', async () => {
    mockAuroraStub.listLatestDraftOrActiveSections.mockResolvedValue([
      pgRow({ section_key: 'intro', ordinal: 0, body: 'first' }),
    ]);
    let payload = await draftAgent.composeDraftPayload('unified');
    const first = await draftAgent.ensureDraftAgent({
      bot: 'unified',
      instructions: payload.instructions,
      Agent,
    });

    mockAuroraStub.listLatestDraftOrActiveSections.mockResolvedValue([
      pgRow({ section_key: 'intro', ordinal: 0, body: 'second' }),
    ]);
    payload = await draftAgent.composeDraftPayload('unified');
    const second = await draftAgent.ensureDraftAgent({
      bot: 'unified',
      instructions: payload.instructions,
      Agent,
    });

    expect(second.id).toBe(first.id);
    const drafts = await Agent.find({ name: DRAFT_NAME }).lean();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].instructions).toContain('second');
    expect(drafts[0].instructions).not.toContain('first');
  });

  it('seed-script entry point loads draftAgent service via path.resolve without throwing', () => {
    const path = require('path');
    const SCRIPT_DIR = path.resolve(__dirname, '..', '..', 'scripts');
    const draftAgentPath = path.resolve(
      SCRIPT_DIR,
      '..',
      'api',
      'server',
      'services',
      'AdminPrompts',
      'draftAgent',
    );
    const loaded = require(draftAgentPath);
    expect(typeof loaded.composeDraftPayload).toBe('function');
    expect(typeof loaded.ensureDraftAgent).toBe('function');
    expect(typeof loaded.canonicalAgentNameFor).toBe('function');
  });
});
