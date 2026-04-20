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

  it('accepts unified as the only valid agentType', async () => {
    const Prompt = mongoose.model('AgentPromptTest2', agentPromptSchema);
    const doc = await Prompt.create({
      agentType: 'unified',
      sectionKey: 'x',
      body: 'y',
    });
    expect(doc.agentType).toBe('unified');
  });

  it('rejects non-unified agentTypes', async () => {
    const Prompt = mongoose.model('AgentPromptTest3', agentPromptSchema);
    for (const bad of ['takanon', 'budgetkey', 'wrong']) {
      await expect(
        Prompt.create({ agentType: bad, sectionKey: 'x', body: 'y' }),
      ).rejects.toThrow();
    }
  });

  it('promptTestQuestion requires agentType + text, defaults enabled:true', async () => {
    const Q = mongoose.model('AgentPromptQTest', agentPromptTestQuestionSchema);
    await expect(Q.create({ agentType: 'unified' })).rejects.toThrow();
    const doc = await Q.create({ agentType: 'unified', text: 'בדיקה' });
    expect(doc.enabled).toBe(true);
  });
});
