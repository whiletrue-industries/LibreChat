import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { agentPromptSchema } from '@librechat/data-schemas';
import type { IAgentPrompt } from '@librechat/data-schemas';
import { getActiveSections, saveDraft, getSectionHistory } from './PromptsService';

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
