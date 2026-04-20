import type { Model, Types } from 'mongoose';
import type { IAgentPrompt, IMessage, IConversation } from '@librechat/data-schemas';
import { assemble } from './assemble';

export type AgentType = 'unified';

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

export class ConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrencyError';
  }
}

export interface PublishInput extends BaseDeps {
  patchAgent: (agentType: AgentType, instructions: string) => Promise<void>;
  agentType: AgentType;
  sectionKey: string;
  parentVersionId: Types.ObjectId;
  body: string;
  changeNote: string;
  createdBy: Types.ObjectId;
}

export async function publish(input: PublishInput): Promise<AgentPromptRow> {
  const current = await input.AgentPrompt
    .findOne({
      agentType: input.agentType,
      sectionKey: input.sectionKey,
      active: true,
    })
    .lean<AgentPromptRow | null>()
    .exec();
  if (!current || String(current._id) !== String(input.parentVersionId)) {
    throw new ConcurrencyError(
      `stale parent for ${input.agentType}/${input.sectionKey}`,
    );
  }
  await input.AgentPrompt
    .updateOne({ _id: current._id }, { $set: { active: false } })
    .exec();
  const doc = await input.AgentPrompt.create({
    agentType: input.agentType,
    sectionKey: input.sectionKey,
    ordinal: current.ordinal,
    headerText: current.headerText,
    body: input.body,
    active: true,
    isDraft: false,
    parentVersionId: current._id,
    changeNote: input.changeNote,
    createdBy: input.createdBy,
    publishedAt: new Date(),
  });
  const created = doc.toObject<AgentPromptRow>();

  const sections = await input.AgentPrompt
    .find({ agentType: input.agentType, active: true })
    .sort({ ordinal: 1 })
    .lean<AgentPromptRow[]>()
    .exec();
  const assembled = assemble(sections);
  await input.patchAgent(input.agentType, assembled);
  return created;
}

export interface RestoreInput extends BaseDeps {
  patchAgent: (agentType: AgentType, instructions: string) => Promise<void>;
  agentType: AgentType;
  sectionKey: string;
  versionId: Types.ObjectId;
  createdBy: Types.ObjectId;
}

export async function restore(input: RestoreInput): Promise<AgentPromptRow> {
  const source = await input.AgentPrompt
    .findById(input.versionId)
    .lean<AgentPromptRow | null>()
    .exec();
  if (!source) {
    throw new Error(`version ${String(input.versionId)} not found`);
  }
  if (
    source.agentType !== input.agentType ||
    source.sectionKey !== input.sectionKey
  ) {
    throw new Error('version does not match agentType/sectionKey');
  }
  const current = await input.AgentPrompt
    .findOne({
      agentType: input.agentType,
      sectionKey: input.sectionKey,
      active: true,
    })
    .lean<AgentPromptRow | null>()
    .exec();
  if (!current) {
    throw new Error('no active section to restore over');
  }
  return publish({
    AgentPrompt: input.AgentPrompt,
    patchAgent: input.patchAgent,
    agentType: input.agentType,
    sectionKey: input.sectionKey,
    parentVersionId: current._id,
    body: source.body,
    changeNote: `Restored from version ${String(source._id).slice(-6)}`,
    createdBy: input.createdBy,
  });
}

export interface GetVersionUsageInput extends BaseDeps {
  Message: Model<IMessage>;
  Conversation: Model<IConversation>;
  agentType: AgentType;
  sectionKey: string;
  versionId: Types.ObjectId;
  liveAgentId: string;
  limit: number;
}

export interface VersionUsageConversation {
  conversationId: string;
  messageCount: number;
  lastMessageAt: Date;
}

export interface VersionUsage {
  windowStart: Date;
  windowEnd: Date | null;
  messageCount: number;
  conversationCount: number;
  conversations: VersionUsageConversation[];
}

interface VersionUsageFacetResult {
  totals: Array<{ messageCount: number }>;
  conversations: Array<{ _id: string; messageCount: number; lastMessageAt: Date }>;
}

export async function getVersionUsage(input: GetVersionUsageInput): Promise<VersionUsage> {
  const target = await input.AgentPrompt
    .findById(input.versionId)
    .lean<AgentPromptRow | null>()
    .exec();
  if (!target) {
    throw new Error(`version ${String(input.versionId)} not found`);
  }
  if (target.agentType !== input.agentType || target.sectionKey !== input.sectionKey) {
    throw new Error('version does not match agentType/sectionKey');
  }
  const windowStart = target.publishedAt ?? target.createdAt;
  const next = await input.AgentPrompt
    .findOne({
      agentType: input.agentType,
      sectionKey: input.sectionKey,
      isDraft: false,
      publishedAt: { $gt: windowStart },
    })
    .sort({ publishedAt: 1 })
    .lean<AgentPromptRow | null>()
    .exec();
  const windowEnd: Date | null = next?.publishedAt ?? null;

  const createdAtFilter: Record<string, Date> = { $gte: windowStart };
  if (windowEnd) {
    createdAtFilter.$lt = windowEnd;
  }

  // LibreChat messages don't store the agent_id — they store the OpenAI model
  // name (e.g. "gpt-5.4-mini") in the `model` field. The agent binding lives
  // on the conversation. So: fetch the conversationIds this liveAgentId owns,
  // then filter messages to only those conversations within the window.
  const agentConvos = await input.Conversation
    .find({ agent_id: input.liveAgentId }, { conversationId: 1 })
    .lean<Array<{ conversationId: string }>>()
    .exec();
  const convoIds = agentConvos.map((c) => c.conversationId);
  if (convoIds.length === 0) {
    return {
      windowStart,
      windowEnd,
      messageCount: 0,
      conversationCount: 0,
      conversations: [],
    };
  }

  const match = {
    isCreatedByUser: false,
    endpoint: 'agents',
    conversationId: { $in: convoIds },
    createdAt: createdAtFilter,
  };

  const facetResults = await input.Message.aggregate<VersionUsageFacetResult>([
    { $match: match },
    {
      $facet: {
        totals: [{ $count: 'messageCount' }],
        conversations: [
          {
            $group: {
              _id: '$conversationId',
              messageCount: { $sum: 1 },
              lastMessageAt: { $max: '$createdAt' },
            },
          },
          { $sort: { lastMessageAt: -1 } },
          { $limit: input.limit },
        ],
      },
    },
  ]);

  const agg = facetResults[0] ?? { totals: [], conversations: [] };
  const messageCount = agg.totals[0]?.messageCount ?? 0;
  const conversations: VersionUsageConversation[] = agg.conversations.map((c) => ({
    conversationId: c._id,
    messageCount: c.messageCount,
    lastMessageAt: c.lastMessageAt,
  }));
  return {
    windowStart,
    windowEnd,
    messageCount,
    conversationCount: conversations.length,
    conversations,
  };
}
