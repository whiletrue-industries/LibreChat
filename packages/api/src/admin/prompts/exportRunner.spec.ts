import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { agentPromptSchema } from '@librechat/data-schemas';
import type { IAgentPrompt } from '@librechat/data-schemas';
import { runExport } from './exportRunner';
import type { ExportWriter } from './exportRunner';
import type { AgentType } from './PromptsService';

function makeFakeWriter() {
  const reads: Record<string, string> = {};
  const writes: Record<string, string> = {};
  const commits: Array<{ message: string; changed: AgentType[] }> = [];
  let sha = 0;
  const writer: ExportWriter = {
    async readFile(a) {
      return reads[a] ?? '';
    },
    async writeFile(a, c) {
      writes[a] = c;
    },
    async commitAndPush(message, changed) {
      sha += 1;
      commits.push({ message, changed });
      return { committedSha: `sha_${sha}` };
    },
  };
  return { writer, reads, writes, commits };
}

describe('runExport', () => {
  let mem: MongoMemoryServer;
  let AgentPrompt: mongoose.Model<IAgentPrompt>;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
    AgentPrompt = mongoose.model<IAgentPrompt>('AgentPromptExport', agentPromptSchema);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  beforeEach(async () => {
    await AgentPrompt.deleteMany({});
  });

  it('no-op when DB is empty', async () => {
    const { writer, commits } = makeFakeWriter();
    const out = await runExport({ AgentPrompt, writer });
    expect(out.changed).toEqual([]);
    expect(out.committedSha).toBeNull();
    expect(commits).toHaveLength(0);
  });

  it('writes + commits the agents whose content changed', async () => {
    await AgentPrompt.create([
      {
        agentType: 'unified',
        sectionKey: 'a',
        body: 'A',
        ordinal: 0,
        active: true,
        isDraft: false,
      },
    ]);
    const { writer, writes, commits } = makeFakeWriter();
    const out = await runExport({ AgentPrompt, writer, now: new Date('2026-04-19') });
    expect(out.changed).toEqual(['unified']);
    expect(writes.unified).toContain('<!-- SECTION_KEY: a -->');
    expect(writes.unified).toContain('A');
    expect(commits).toHaveLength(1);
    expect(commits[0].message).toBe('chore(prompt): nightly DB export 2026-04-19');
    expect(commits[0].changed).toEqual(['unified']);
  });

  it('no commit when file content matches assembled output', async () => {
    await AgentPrompt.create([
      {
        agentType: 'unified',
        sectionKey: 'a',
        body: 'A',
        ordinal: 0,
        active: true,
        isDraft: false,
      },
    ]);
    const { writer, commits } = makeFakeWriter();
    await runExport({ AgentPrompt, writer });
    const reads: Record<string, string> = {
      unified: '<!-- SECTION_KEY: a -->\nA',
      takanon: '',
      budgetkey: '',
    };
    writer.readFile = async (a) => reads[a];
    const out = await runExport({ AgentPrompt, writer });
    expect(out.committedSha).toBeNull();
    expect(commits).toHaveLength(1);
  });
});
