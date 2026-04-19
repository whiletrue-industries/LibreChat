import type { Model, Types } from 'mongoose';
import type { IAgentPrompt } from '@librechat/data-schemas';

export type AgentType = 'unified' | 'takanon' | 'budgetkey';

export interface AgentPromptRow {
  _id: Types.ObjectId;
  agentType: AgentType;
  sectionKey: string;
  ordinal: number;
  headerText: string;
  body: string;
  active: boolean;
  isDraft: boolean;
  parentVersionId?: Types.ObjectId;
  changeNote?: string;
  createdAt: Date;
  createdBy?: Types.ObjectId;
  publishedAt?: Date;
}

export interface BaseDeps {
  AgentPrompt: Model<IAgentPrompt>;
}

export interface GetActiveSectionsInput {
  AgentPrompt: Model<IAgentPrompt>;
  agentType: AgentType;
}

export interface GetSectionHistoryInput {
  AgentPrompt: Model<IAgentPrompt>;
  agentType: AgentType;
  sectionKey: string;
}

export interface SaveDraftInput {
  AgentPrompt: Model<IAgentPrompt>;
  agentType: AgentType;
  sectionKey: string;
  body: string;
  changeNote?: string;
  createdBy: Types.ObjectId;
}

export async function getActiveSections(
  deps: GetActiveSectionsInput,
): Promise<AgentPromptRow[]> {
  return deps.AgentPrompt.find({
    agentType: deps.agentType,
    active: true,
  })
    .sort({ ordinal: 1 })
    .lean<AgentPromptRow[]>()
    .exec();
}

export async function getSectionHistory(
  deps: GetSectionHistoryInput,
): Promise<AgentPromptRow[]> {
  return deps.AgentPrompt.find({
    agentType: deps.agentType,
    sectionKey: deps.sectionKey,
  })
    .sort({ createdAt: -1 })
    .lean<AgentPromptRow[]>()
    .exec();
}

export async function saveDraft(input: SaveDraftInput): Promise<AgentPromptRow> {
  const active = await input.AgentPrompt.findOne({
    agentType: input.agentType,
    sectionKey: input.sectionKey,
    active: true,
  })
    .lean<AgentPromptRow | null>()
    .exec();

  if (!active) {
    throw new Error(
      `no active section for ${input.agentType}/${input.sectionKey}`,
    );
  }

  const doc = await input.AgentPrompt.create({
    agentType: input.agentType,
    sectionKey: input.sectionKey,
    ordinal: active.ordinal,
    headerText: active.headerText,
    body: input.body,
    active: false,
    isDraft: true,
    parentVersionId: active._id,
    changeNote: input.changeNote,
    createdBy: input.createdBy,
  });

  return doc.toObject<AgentPromptRow>();
}
