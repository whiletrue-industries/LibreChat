import { Schema } from 'mongoose';
import type { IAgentPrompt } from '../types/agentPrompt';

const agentPromptSchema = new Schema<IAgentPrompt>({
  agentType: {
    type: String,
    enum: ['unified'],
    required: true,
    index: true,
  },
  sectionKey: { type: String, required: true, index: true },
  ordinal: { type: Number, required: true, default: 0 },
  headerText: { type: String, default: '' },
  body: { type: String, required: true },
  active: { type: Boolean, default: false },
  isDraft: { type: Boolean, default: true },
  parentVersionId: { type: Schema.Types.ObjectId },
  changeNote: { type: String },
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  publishedAt: { type: Date },
});

agentPromptSchema.index(
  { agentType: 1, sectionKey: 1 },
  { partialFilterExpression: { active: true }, name: 'active_by_agent_section' },
);
agentPromptSchema.index({ agentType: 1, sectionKey: 1, createdAt: -1 });

export default agentPromptSchema;
