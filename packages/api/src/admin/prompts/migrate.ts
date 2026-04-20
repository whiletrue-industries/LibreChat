import type { Model } from 'mongoose';
import type { IAgentPrompt } from '@librechat/data-schemas';
import { parseMarkers } from './parseMarkers';
import type { AgentType } from './PromptsService';

export interface MigrateInput {
  AgentPrompt: Model<IAgentPrompt>;
  agentType: AgentType;
  fileContents: string;
}

export async function migrateAgentTextIntoDb(input: MigrateInput): Promise<number> {
  const existing = await input.AgentPrompt.countDocuments({ agentType: input.agentType });
  if (existing > 0) {
    return 0;
  }
  const sections = parseMarkers(input.fileContents);
  const docs = sections.map((s) => ({
    agentType: input.agentType,
    sectionKey: s.sectionKey,
    ordinal: s.ordinal,
    headerText: s.headerText,
    body: s.body,
    active: true,
    isDraft: false,
    publishedAt: new Date(),
  }));
  await input.AgentPrompt.insertMany(docs);
  return docs.length;
}
