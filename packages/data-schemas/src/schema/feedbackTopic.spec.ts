import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import feedbackTopicSchema from './feedbackTopic';
import feedbackTopicPendingSchema from './feedbackTopicPending';

describe('feedbackTopic schemas', () => {
  let mem: MongoMemoryServer;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  it('enforces unique key on feedbackTopic', async () => {
    const Topic = mongoose.model('TopicTest', feedbackTopicSchema);
    await Topic.init();
    await Topic.create({ key: 'budget', labelHe: 'תקציב', labelEn: 'Budget' });
    await expect(
      Topic.create({ key: 'budget', labelHe: 'x', labelEn: 'x' }),
    ).rejects.toThrow(/duplicate key/);
  });

  it('defaults status=pending on feedbackTopicPending', async () => {
    const Pending = mongoose.model('PendingTest', feedbackTopicPendingSchema);
    const doc = await Pending.create({
      proposedKey: 'ethics',
      labelHe: 'אתיקה',
      labelEn: 'Ethics',
    });
    expect(doc.status).toBe('pending');
    expect(doc.proposedAt).toBeInstanceOf(Date);
  });
});
