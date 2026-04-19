import { Schema } from 'mongoose';
import type { IFeedbackTopicPending } from '~/types/feedbackTopic';

const feedbackTopicPendingSchema = new Schema<IFeedbackTopicPending>({
  proposedKey: { type: String, required: true },
  labelHe: { type: String, required: true },
  labelEn: { type: String, required: true },
  rawLabels: { type: [String], default: [] },
  exampleMessageIds: { type: [String], default: [] },
  status: {
    type: String,
    enum: ['pending', 'rejected'],
    default: 'pending',
    index: true,
  },
  proposedAt: { type: Date, default: Date.now },
  reviewedAt: { type: Date },
  reviewedBy: { type: String },
});

export default feedbackTopicPendingSchema;
