import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { feedbackTopicSchema } from '@librechat/data-schemas';
import { seedIfEmpty } from './seed';

describe('seedIfEmpty', () => {
  let mem: MongoMemoryServer;
  let FeedbackTopic: mongoose.Model<unknown>;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
    FeedbackTopic = mongoose.model('FeedbackTopicSeed', feedbackTopicSchema);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  it('seeds initial taxonomy when empty', async () => {
    const count = await seedIfEmpty(FeedbackTopic);
    expect(count).toBeGreaterThan(0);
    const row = (await FeedbackTopic.findOne({ key: 'budget_ministries' }).lean()) as {
      labelHe: string;
    } | null;
    expect(row).toBeTruthy();
    expect(row!.labelHe).toBeTruthy();
  });

  it('is a no-op when topics exist', async () => {
    const count = await seedIfEmpty(FeedbackTopic);
    expect(count).toBe(0);
  });
});
