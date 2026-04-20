import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { agentPromptSchema } from '@librechat/data-schemas';
import type { IAgentPrompt } from '@librechat/data-schemas';
import { migrateAgentTextIntoDb } from './migrate';

describe('migrateAgentTextIntoDb', () => {
  let mem: MongoMemoryServer;
  let AgentPrompt: mongoose.Model<IAgentPrompt>;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
    AgentPrompt = mongoose.model<IAgentPrompt>('AgentPromptMig1', agentPromptSchema);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  beforeEach(async () => {
    await AgentPrompt.deleteMany({});
  });

  it('creates one active row per SECTION_KEY in the input', async () => {
    const input = [
      '<!-- SECTION_KEY: a -->',
      'A body',
      '',
      '<!-- SECTION_KEY: b -->',
      '## B header',
      'B body',
    ].join('\n');
    const count = await migrateAgentTextIntoDb({
      AgentPrompt,
      agentType: 'unified',
      fileContents: input,
    });
    expect(count).toBe(2);
    const rows = await AgentPrompt.find({ agentType: 'unified', active: true }).sort({ ordinal: 1 });
    expect(rows.map((r) => r.sectionKey)).toEqual(['a', 'b']);
    expect(rows[1].headerText).toBe('## B header');
  });

  it('is idempotent — second call is a no-op if rows exist', async () => {
    const input = '<!-- SECTION_KEY: a -->\nbody';
    const first = await migrateAgentTextIntoDb({
      AgentPrompt,
      agentType: 'unified',
      fileContents: input,
    });
    const second = await migrateAgentTextIntoDb({
      AgentPrompt,
      agentType: 'unified',
      fileContents: input,
    });
    expect(first).toBe(1);
    expect(second).toBe(0);
  });
});
