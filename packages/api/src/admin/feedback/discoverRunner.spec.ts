import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { messageSchema, feedbackTopicPendingSchema } from '@librechat/data-schemas';
import { runDiscover } from './discoverRunner';
import { buildFakeLlm } from './fakeLlm';

describe('discoverRunner', () => {
  let mem: MongoMemoryServer;
  let Message: mongoose.Model<unknown>;
  let PendingTopic: mongoose.Model<unknown>;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
    Message = mongoose.model('MessageDiscover', messageSchema);
    PendingTopic = mongoose.model('PendingDiscover', feedbackTopicPendingSchema);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  beforeEach(async () => {
    await Message.deleteMany({});
    await PendingTopic.deleteMany({});
  });

  it('proposes clusters and writes to PendingTopic', async () => {
    await Message.create({
      messageId: 'a1',
      conversationId: 'c',
      user: 'u',
      isCreatedByUser: false,
      feedback: {
        rating: 'thumbsDown',
        topic: 'other:תקציב חינוך',
        topicSource: 'llm',
        topicClassifiedAt: new Date(),
      },
    });
    const llm = buildFakeLlm({
      default: JSON.stringify([
        {
          proposedKey: 'sector_budget',
          labelHe: 'תקציב מגזרי',
          labelEn: 'Sector budget',
          rawLabels: ['other:תקציב חינוך'],
        },
      ]),
    });
    const result = await runDiscover({ Message, PendingTopic, llm });
    expect(result).toEqual({ proposals: 1, status: 'ok' });
    const row = (await PendingTopic.findOne({ proposedKey: 'sector_budget' }).lean()) as {
      exampleMessageIds: string[];
    } | null;
    expect(row).toBeTruthy();
    expect(row!.exampleMessageIds).toEqual(['a1']);
  });

  it('returns no-new-labels when nothing matches', async () => {
    const llm = buildFakeLlm({});
    const result = await runDiscover({ Message, PendingTopic, llm });
    expect(result.status).toBe('no-new-labels');
  });
});
