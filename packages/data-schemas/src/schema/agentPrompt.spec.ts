import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import agentPromptSchema from './agentPrompt';
import agentPromptTestQuestionSchema from './agentPromptTestQuestion';

describe('agent prompt schemas', () => {
  let mem: MongoMemoryServer;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  it('partial index active_by_agent_section is defined', async () => {
    const Prompt = mongoose.model('AgentPromptTest', agentPromptSchema);
    await Prompt.init();
    await Prompt.create({
      agentType: 'unified',
      sectionKey: 'preamble',
      body: 'v1',
      active: true,
      isDraft: false,
    });
    const indexes = await Prompt.collection.indexes();
    expect(indexes.find((i) => i.name === 'active_by_agent_section')).toBeDefined();
  });

  it('accepts all valid agentType enum values', async () => {
    const Prompt = mongoose.model('AgentPromptTest2', agentPromptSchema);
    for (const type of ['unified', 'takanon', 'budgetkey'] as const) {
      const doc = await Prompt.create({
        agentType: type,
        sectionKey: 'x',
        body: 'y',
      });
      expect(doc.agentType).toBe(type);
    }
  });

  it('rejects invalid agentType', async () => {
    const Prompt = mongoose.model('AgentPromptTest3', agentPromptSchema);
    await expect(
      Prompt.create({ agentType: 'wrong', sectionKey: 'x', body: 'y' }),
    ).rejects.toThrow();
  });

  it('promptTestQuestion requires agentType + text, defaults enabled:true', async () => {
    const Q = mongoose.model('AgentPromptQTest', agentPromptTestQuestionSchema);
    await expect(Q.create({ agentType: 'unified' })).rejects.toThrow();
    const doc = await Q.create({ agentType: 'unified', text: 'בדיקה' });
    expect(doc.enabled).toBe(true);
  });
});
