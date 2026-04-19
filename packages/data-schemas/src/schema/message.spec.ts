import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import messageSchema from './message';

describe('message.feedback.topic', () => {
  let mem: MongoMemoryServer;
  let Message: mongoose.Model<unknown>;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
    Message = mongoose.model('MessageTest', messageSchema);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  it('accepts feedback.topic, topicSource, topicClassifiedAt', async () => {
    const doc = await Message.create({
      messageId: 'm1',
      conversationId: 'c1',
      user: 'u1',
      feedback: {
        rating: 'thumbsUp',
        topic: 'budget_ministries',
        topicSource: 'taxonomy',
        topicClassifiedAt: new Date('2026-04-19T02:05:00Z'),
      },
    });
    const fetched = await Message.findById(doc._id).lean();
    expect(fetched?.feedback?.topic).toBe('budget_ministries');
    expect(fetched?.feedback?.topicSource).toBe('taxonomy');
    expect(fetched?.feedback?.topicClassifiedAt).toBeInstanceOf(Date);
  });

  it('rejects invalid topicSource', async () => {
    await expect(
      Message.create({
        messageId: 'm2',
        conversationId: 'c1',
        user: 'u1',
        feedback: { rating: 'thumbsDown', topic: 'x', topicSource: 'invalid' },
      }),
    ).rejects.toThrow();
  });
});
