import type { Document } from 'mongoose';

export interface IFeedbackTopic extends Document {
  key: string;
  labelHe: string;
  labelEn: string;
  keywords: string[];
  active: boolean;
  createdAt: Date;
  createdBy?: string;
}

export interface IFeedbackTopicPending extends Document {
  proposedKey: string;
  labelHe: string;
  labelEn: string;
  rawLabels: string[];
  exampleMessageIds: string[];
  status: 'pending' | 'rejected';
  proposedAt: Date;
  reviewedAt?: Date;
  reviewedBy?: string;
}
