import { Schema } from 'mongoose';
import type { IAgentPromptTestQuestion } from '../types/agentPrompt';

const agentPromptTestQuestionSchema = new Schema<IAgentPromptTestQuestion>({
  agentType: {
    type: String,
    enum: ['unified', 'takanon', 'budgetkey'],
    required: true,
    index: true,
  },
  text: { type: String, required: true },
  ordinal: { type: Number, default: 0 },
  enabled: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
});

export default agentPromptTestQuestionSchema;
