import { Schema } from 'mongoose';
import type { IFeedbackTopic } from '~/types/feedbackTopic';

const feedbackTopicSchema = new Schema<IFeedbackTopic>({
  key: { type: String, required: true, unique: true, index: true },
  labelHe: { type: String, required: true },
  labelEn: { type: String, required: true },
  keywords: { type: [String], default: [] },
  active: { type: Boolean, default: true, index: true },
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: String },
});

export default feedbackTopicSchema;
