import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { messageSchema } from '@librechat/data-schemas';
import { run } from './runner';
import { buildFakeLlm } from './fakeLlm';

describe('classify-feedback-topics runner', () => {
  let mem: MongoMemoryServer;
  let Message: mongoose.Model<unknown>;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
    Message = mongoose.model('MessageRunnerTest', messageSchema);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  beforeEach(async () => {
    await Message.deleteMany({});
  });

  async function seedPair(userText: string, withFeedback: boolean) {
    const userMsgId = `u-${Math.random()}`;
    await Message.create({
      messageId: userMsgId,
      conversationId: 'c1',
      user: 'u1',
      isCreatedByUser: true,
      text: userText,
      parentMessageId: null,
    });
    const assistantId = `a-${Math.random()}`;
    const assistantMsg = await Message.create({
      messageId: assistantId,
      conversationId: 'c1',
      user: 'u1',
      isCreatedByUser: false,
      text: 'answer',
      parentMessageId: userMsgId,
      feedback: withFeedback ? { rating: 'thumbsUp' } : undefined,
    });
    return { userMsgId, assistantMsg };
  }

  it('classifies feedback messages via taxonomy', async () => {
    const { assistantMsg } = await seedPair('מה תקציב משרד החינוך?', true);
    const llm = buildFakeLlm({ default: 'other:unmapped' });
    const stats = await run({ Message, llm, limit: 100, dryRun: false });
    expect(stats.processed).toBe(1);
    expect(stats.taxonomyHits).toBe(1);
    const reloaded = (await Message.findById(assistantMsg._id).lean()) as {
      feedback: { topic?: string; topicSource?: string };
    };
    expect(reloaded.feedback.topic).toBe('budget_ministries');
    expect(reloaded.feedback.topicSource).toBe('taxonomy');
  });

  it('skips messages without feedback', async () => {
    await seedPair('שאלה בלי משוב', false);
    const llm = buildFakeLlm({ default: 'other:none' });
    const stats = await run({ Message, llm, limit: 100, dryRun: false });
    expect(stats.processed).toBe(0);
  });

  it('is idempotent — second run is a no-op', async () => {
    await seedPair('מה תקציב משרד החינוך?', true);
    const llm = buildFakeLlm({ default: 'other:unmapped' });
    const first = await run({ Message, llm, limit: 100, dryRun: false });
    const second = await run({ Message, llm, limit: 100, dryRun: false });
    expect(first.processed).toBe(1);
    expect(second.processed).toBe(0);
  });

  it('dry-run does not write', async () => {
    const { assistantMsg } = await seedPair('מה תקציב משרד החינוך?', true);
    const llm = buildFakeLlm({ default: 'other:unmapped' });
    await run({ Message, llm, limit: 100, dryRun: true });
    const reloaded = (await Message.findById(assistantMsg._id).lean()) as {
      feedback: { topic?: string };
    };
    expect(reloaded.feedback.topic).toBeUndefined();
  });

  it('honors limit cap', async () => {
    await seedPair('מה תקציב משרד החינוך?', true);
    await seedPair('סעיף 106 לתקנון', true);
    const llm = buildFakeLlm({ default: 'other:unmapped' });
    const stats = await run({ Message, llm, limit: 1, dryRun: false });
    expect(stats.processed).toBe(1);
  });
});
