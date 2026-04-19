import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { agentPromptSchema, messageSchema } from '@librechat/data-schemas';
import type { IAgentPrompt, IMessage, AgentType } from '@librechat/data-schemas';
import {
  getActiveSections,
  saveDraft,
  getSectionHistory,
  publish,
  restore,
  getVersionUsage,
  ConcurrencyError,
} from './PromptsService';

describe('PromptsService reads + saveDraft', () => {
  let mem: MongoMemoryServer;
  let AgentPrompt: mongoose.Model<IAgentPrompt>;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
    AgentPrompt = mongoose.model<IAgentPrompt>('AgentPromptSvc', agentPromptSchema);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  beforeEach(async () => {
    await AgentPrompt.deleteMany({});
  });

  it('getActiveSections returns only active rows, ordinal-sorted', async () => {
    await AgentPrompt.create([
      {
        agentType: 'unified',
        sectionKey: 'a',
        body: 'A1',
        ordinal: 0,
        active: true,
        isDraft: false,
      },
      {
        agentType: 'unified',
        sectionKey: 'b',
        body: 'B1',
        ordinal: 1,
        active: true,
        isDraft: false,
      },
      {
        agentType: 'unified',
        sectionKey: 'a',
        body: 'A0-old',
        ordinal: 0,
        active: false,
        isDraft: false,
      },
    ]);
    const out = await getActiveSections({ AgentPrompt, agentType: 'unified' });
    expect(out.map((s) => s.body)).toEqual(['A1', 'B1']);
  });

  it('saveDraft inserts a new isDraft:true row referencing the parent', async () => {
    const parent = await AgentPrompt.create({
      agentType: 'unified',
      sectionKey: 'a',
      body: 'A1',
      ordinal: 0,
      active: true,
      isDraft: false,
    });
    const draft = await saveDraft({
      AgentPrompt,
      agentType: 'unified',
      sectionKey: 'a',
      body: 'A1-draft',
      changeNote: 'wip',
      createdBy: new mongoose.Types.ObjectId(),
    });
    expect(draft.isDraft).toBe(true);
    expect(draft.active).toBe(false);
    expect(draft.parentVersionId?.toString()).toBe(parent.id);
  });

  it('saveDraft throws when no active section exists', async () => {
    await expect(
      saveDraft({
        AgentPrompt,
        agentType: 'unified',
        sectionKey: 'missing',
        body: 'x',
        changeNote: undefined,
        createdBy: new mongoose.Types.ObjectId(),
      }),
    ).rejects.toThrow(/no active section/i);
  });

  it('getSectionHistory returns newest-first', async () => {
    await AgentPrompt.create([
      {
        agentType: 'unified',
        sectionKey: 'a',
        body: 'v1',
        ordinal: 0,
        active: false,
        isDraft: false,
        createdAt: new Date('2026-01-01'),
      },
      {
        agentType: 'unified',
        sectionKey: 'a',
        body: 'v2',
        ordinal: 0,
        active: true,
        isDraft: false,
        createdAt: new Date('2026-02-01'),
      },
    ]);
    const hist = await getSectionHistory({
      AgentPrompt,
      agentType: 'unified',
      sectionKey: 'a',
    });
    expect(hist.map((r) => r.body)).toEqual(['v2', 'v1']);
  });
});

describe('PromptsService.publish + restore', () => {
  let mem: MongoMemoryServer;
  let AgentPrompt: mongoose.Model<IAgentPrompt>;
  let patchCalls: Array<{ agentType: string; instructions: string }>;
  const patchAgent = async (agentType: AgentType, instructions: string) => {
    patchCalls.push({ agentType, instructions });
  };

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
    AgentPrompt = mongoose.model<IAgentPrompt>(
      'AgentPromptPublishSvc',
      agentPromptSchema,
    );
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  beforeEach(async () => {
    await AgentPrompt.deleteMany({});
    patchCalls = [];
  });

  it('flips active, inserts new row, calls patchAgent with assembled body', async () => {
    const parent = await AgentPrompt.create({
      agentType: 'unified',
      sectionKey: 'a',
      body: 'A1',
      ordinal: 0,
      active: true,
      isDraft: false,
    });
    const parentId = new mongoose.Types.ObjectId(String(parent._id));
    await publish({
      AgentPrompt,
      patchAgent,
      agentType: 'unified',
      sectionKey: 'a',
      parentVersionId: parentId,
      body: 'A2',
      changeNote: 'tightened',
      createdBy: new mongoose.Types.ObjectId(),
    });
    const rows = await AgentPrompt.find({ agentType: 'unified' }).sort({ createdAt: 1 });
    expect(rows).toHaveLength(2);
    expect(rows[0].active).toBe(false);
    expect(rows[1].active).toBe(true);
    expect(rows[1].body).toBe('A2');
    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0].instructions).toContain('<!-- SECTION_KEY: a -->');
    expect(patchCalls[0].instructions).toContain('A2');
  });

  it('rejects with ConcurrencyError when parentVersionId is stale', async () => {
    await AgentPrompt.create({
      agentType: 'unified',
      sectionKey: 'a',
      body: 'A1',
      ordinal: 0,
      active: true,
      isDraft: false,
    });
    await expect(
      publish({
        AgentPrompt,
        patchAgent,
        agentType: 'unified',
        sectionKey: 'a',
        parentVersionId: new mongoose.Types.ObjectId(),
        body: 'A2',
        changeNote: 'x',
        createdBy: new mongoose.Types.ObjectId(),
      }),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('restore creates a new active row with body cloned from a prior version', async () => {
    const v1 = await AgentPrompt.create({
      agentType: 'unified',
      sectionKey: 'a',
      body: 'A1',
      ordinal: 0,
      active: true,
      isDraft: false,
    });
    const v1Id = new mongoose.Types.ObjectId(String(v1._id));
    await publish({
      AgentPrompt,
      patchAgent,
      agentType: 'unified',
      sectionKey: 'a',
      parentVersionId: v1Id,
      body: 'A2',
      changeNote: 'x',
      createdBy: new mongoose.Types.ObjectId(),
    });
    await restore({
      AgentPrompt,
      patchAgent,
      agentType: 'unified',
      sectionKey: 'a',
      versionId: v1Id,
      createdBy: new mongoose.Types.ObjectId(),
    });
    const active = await AgentPrompt.findOne({
      agentType: 'unified',
      sectionKey: 'a',
      active: true,
    });
    expect(active?.body).toBe('A1');
    expect(active?.changeNote).toMatch(/Restored from version/i);
  });
});

describe('PromptsService.getVersionUsage', () => {
  let mem: MongoMemoryServer;
  let AgentPrompt: mongoose.Model<IAgentPrompt>;
  let Message: mongoose.Model<IMessage>;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
    AgentPrompt = mongoose.model<IAgentPrompt>('AgentPromptUsage', agentPromptSchema);
    Message = mongoose.model<IMessage>('MessageUsage', messageSchema);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  beforeEach(async () => {
    await AgentPrompt.deleteMany({});
    await Message.deleteMany({});
  });

  async function seedVersions() {
    const v1 = await AgentPrompt.create({
      agentType: 'unified',
      sectionKey: 'preamble',
      body: 'v1',
      ordinal: 0,
      active: false,
      isDraft: false,
      publishedAt: new Date('2026-04-01'),
    });
    const v2 = await AgentPrompt.create({
      agentType: 'unified',
      sectionKey: 'preamble',
      body: 'v2',
      ordinal: 0,
      active: true,
      isDraft: false,
      publishedAt: new Date('2026-04-10'),
    });
    return { v1, v2 };
  }

  it('returns window bounds, counts, and top conversations for a past version', async () => {
    const { v1 } = await seedVersions();
    await Message.create([
      { conversationId: 'c1', messageId: 'm1', user: 'u1', isCreatedByUser: false, endpoint: 'agents', model: 'agent_live', createdAt: new Date('2026-04-02') },
      { conversationId: 'c1', messageId: 'm2', user: 'u1', isCreatedByUser: false, endpoint: 'agents', model: 'agent_live', createdAt: new Date('2026-04-03') },
      { conversationId: 'c2', messageId: 'm3', user: 'u1', isCreatedByUser: false, endpoint: 'agents', model: 'agent_live', createdAt: new Date('2026-04-04') },
      { conversationId: 'c1', messageId: 'm4', user: 'u1', isCreatedByUser: true, endpoint: 'agents', model: 'agent_live', createdAt: new Date('2026-04-02') },
      { conversationId: 'c3', messageId: 'm5', user: 'u1', isCreatedByUser: false, endpoint: 'agents', model: 'agent_live', createdAt: new Date('2026-04-11') },
    ]);
    const out = await getVersionUsage({
      AgentPrompt,
      Message,
      agentType: 'unified',
      sectionKey: 'preamble',
      versionId: new mongoose.Types.ObjectId(String(v1._id)),
      liveAgentId: 'agent_live',
      limit: 50,
    });
    expect(out.windowStart).toEqual(new Date('2026-04-01'));
    expect(out.windowEnd).toEqual(new Date('2026-04-10'));
    expect(out.messageCount).toBe(3);
    expect(out.conversationCount).toBe(2);
    expect(out.conversations.map((c) => c.conversationId).sort()).toEqual(['c1', 'c2']);
    const c1 = out.conversations.find((c) => c.conversationId === 'c1');
    expect(c1?.messageCount).toBe(2);
  });

  it('returns open-ended window for the current active version', async () => {
    const { v2 } = await seedVersions();
    await Message.create({
      conversationId: 'c3',
      messageId: 'm1',
      user: 'u1',
      isCreatedByUser: false,
      endpoint: 'agents',
      model: 'agent_live',
      createdAt: new Date('2026-04-11'),
    });
    const out = await getVersionUsage({
      AgentPrompt,
      Message,
      agentType: 'unified',
      sectionKey: 'preamble',
      versionId: new mongoose.Types.ObjectId(String(v2._id)),
      liveAgentId: 'agent_live',
      limit: 50,
    });
    expect(out.windowEnd).toBeNull();
    expect(out.messageCount).toBe(1);
  });

  it('throws when versionId is not for this (agent, section)', async () => {
    const stray = await AgentPrompt.create({
      agentType: 'unified',
      sectionKey: 'different_key',
      body: 'x',
      ordinal: 0,
      active: true,
      isDraft: false,
      publishedAt: new Date('2026-04-01'),
    });
    await expect(
      getVersionUsage({
        AgentPrompt,
        Message,
        agentType: 'unified',
        sectionKey: 'preamble',
        versionId: new mongoose.Types.ObjectId(String(stray._id)),
        liveAgentId: 'agent_live',
        limit: 50,
      }),
    ).rejects.toThrow(/does not match/i);
  });
});
