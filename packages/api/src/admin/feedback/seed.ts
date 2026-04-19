import type { Model } from 'mongoose';
import { initialTaxonomy } from './taxonomy';

export async function seedIfEmpty(FeedbackTopic: Model<unknown>): Promise<number> {
  const existing = await FeedbackTopic.countDocuments({});
  if (existing > 0) {
    return 0;
  }
  const docs = initialTaxonomy.map((entry) => ({
    key: entry.key,
    labelHe: entry.labelHe,
    labelEn: entry.labelEn,
    keywords: entry.keywords,
    active: true,
  }));
  await FeedbackTopic.insertMany(docs);
  return docs.length;
}
