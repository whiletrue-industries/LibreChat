import type { Model } from 'mongoose';
import type { IAgentPrompt } from '@librechat/data-schemas';
import { getActiveSections } from './PromptsService';
import { assemble } from './assemble';
import type { AgentType } from './PromptsService';

export interface ExportWriter {
  readFile(agentType: AgentType): Promise<string>;
  writeFile(agentType: AgentType, contents: string): Promise<void>;
  commitAndPush(
    message: string,
    changedAgentTypes: AgentType[],
  ): Promise<{ committedSha: string | null }>;
}

export interface RunExportInput {
  AgentPrompt: Model<IAgentPrompt>;
  writer: ExportWriter;
  now?: Date;
}

export interface RunExportResult {
  changed: AgentType[];
  committedSha: string | null;
}

const AGENTS: AgentType[] = ['unified', 'takanon', 'budgetkey'];

export async function runExport(input: RunExportInput): Promise<RunExportResult> {
  const changed: AgentType[] = [];
  for (const agentType of AGENTS) {
    const sections = await getActiveSections({
      AgentPrompt: input.AgentPrompt,
      agentType,
    });
    if (sections.length === 0) {
      continue;
    }
    const next = assemble(sections);
    const prev = await input.writer.readFile(agentType);
    if (next.trim() === prev.trim()) {
      continue;
    }
    await input.writer.writeFile(agentType, next);
    changed.push(agentType);
  }
  if (changed.length === 0) {
    return { changed: [], committedSha: null };
  }
  const now = (input.now ?? new Date()).toISOString().slice(0, 10);
  const { committedSha } = await input.writer.commitAndPush(
    `chore(prompt): nightly DB export ${now}`,
    changed,
  );
  return { changed, committedSha };
}
