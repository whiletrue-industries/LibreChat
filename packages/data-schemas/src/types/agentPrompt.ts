import type { Document, Types } from 'mongoose';

export type AgentType = 'unified' | 'takanon' | 'budgetkey';

export interface IAgentPrompt extends Document {
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

export interface IAgentPromptTestQuestion extends Document {
  agentType: AgentType;
  text: string;
  ordinal: number;
  enabled: boolean;
  createdAt: Date;
  createdBy?: Types.ObjectId;
}
