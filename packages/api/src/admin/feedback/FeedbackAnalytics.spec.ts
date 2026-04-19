import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  messageSchema,
  feedbackTopicSchema,
  feedbackTopicPendingSchema,
} from '@librechat/data-schemas';
import { aggregateOverview, listMessagesByFilter, approvePendingTopic } from './FeedbackAnalytics';

describe('FeedbackAnalytics.aggregateOverview', () => {
  let mem: MongoMemoryServer;
  let Message: mongoose.Model<unknown>;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
    Message = mongoose.model('MessageOverview', messageSchema);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  beforeEach(async () => {
    await Message.deleteMany({});
  });

  async function seed(n: number, overrides: Record<string, unknown> = {}) {
    for (let i = 0; i < n; i += 1) {
      await Message.create({
        messageId: `m${i}-${Math.random()}`,
        conversationId: 'c',
        user: 'u',
        isCreatedByUser: false,
        endpoint: 'agents',
        feedback: {
          rating: i % 3 === 0 ? 'thumbsDown' : 'thumbsUp',
          topic: 'budget_ministries',
          topicSource: 'taxonomy',
        },
        createdAt: new Date('2026-04-18T10:00:00Z'),
        ...overrides,
      });
    }
  }

  it('reports zeros on empty collection', async () => {
    const result = await aggregateOverview({ Message });
    expect(result.kpis.total).toBe(0);
    expect(result.kpis.withFeedback).toBe(0);
    expect(result.byTopic).toEqual([]);
    expect(result.byTool).toEqual([]);
  });

  it('computes totals + positive %', async () => {
    await seed(6);
    const result = await aggregateOverview({ Message });
    expect(result.kpis.total).toBe(6);
    expect(result.kpis.withFeedback).toBe(6);
    expect(result.kpis.thumbsUp).toBe(4);
    expect(result.kpis.thumbsDown).toBe(2);
    expect(result.kpis.positivePct).toBeCloseTo((4 / 6) * 100, 1);
  });

  it('groups by topic', async () => {
    await seed(3);
    await seed(2, {
      feedback: { rating: 'thumbsDown', topic: 'ethics', topicSource: 'taxonomy' },
    });
    const result = await aggregateOverview({ Message });
    const topics = result.byTopic.map((t) => t.topic).sort();
    expect(topics).toEqual(['budget_ministries', 'ethics']);
  });

  it('honors since/until filter', async () => {
    await seed(3);
    await seed(2, { createdAt: new Date('2024-01-01T00:00:00Z') });
    const result = await aggregateOverview({
      Message,
      since: new Date('2026-01-01T00:00:00Z'),
    });
    expect(result.kpis.total).toBe(3);
  });
});

describe('FeedbackAnalytics.listMessagesByFilter', () => {
  let mem: MongoMemoryServer;
  let Message: mongoose.Model<unknown>;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
    Message = mongoose.model('MessageDrillDown', messageSchema);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  beforeEach(async () => {
    await Message.deleteMany({});
  });

  it('paginates drill-down results in descending createdAt', async () => {
    for (let i = 0; i < 15; i += 1) {
      await Message.create({
        messageId: `m${i}`,
        conversationId: 'c',
        user: 'u',
        isCreatedByUser: false,
        feedback: { rating: 'thumbsDown', topic: 'ethics', topicSource: 'taxonomy' },
        createdAt: new Date(Date.now() - i * 60_000),
      });
    }
    const page1 = await listMessagesByFilter({
      Message,
      topic: 'ethics',
      rating: 'thumbsDown',
      pageSize: 10,
    });
    expect(page1.messages).toHaveLength(10);
    expect(page1.nextCursor).toBeTruthy();

    const page2 = await listMessagesByFilter({
      Message,
      topic: 'ethics',
      rating: 'thumbsDown',
      pageSize: 10,
      cursor: page1.nextCursor ?? undefined,
    });
    expect(page2.messages).toHaveLength(5);
    expect(page2.nextCursor).toBeNull();
  });
});

describe('FeedbackAnalytics.approvePendingTopic', () => {
  let mem: MongoMemoryServer;
  let Message: mongoose.Model<unknown>;
  let Topic: mongoose.Model<unknown>;
  let Pending: mongoose.Model<unknown>;

  beforeAll(async () => {
    mem = await MongoMemoryServer.create();
    await mongoose.connect(mem.getUri());
    Message = mongoose.model('MessageApprove', messageSchema);
    Topic = mongoose.model('TopicApprove', feedbackTopicSchema);
    Pending = mongoose.model('PendingApprove', feedbackTopicPendingSchema);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mem.stop();
  });

  beforeEach(async () => {
    await Message.deleteMany({});
    await Topic.deleteMany({});
    await Pending.deleteMany({});
  });

  it('inserts feedbackTopic, optionally rewrites messages, deletes pending', async () => {
    await Message.create({
      messageId: 'm-rewrite',
      conversationId: 'c',
      user: 'u',
      isCreatedByUser: false,
      feedback: {
        rating: 'thumbsUp',
        topic: 'other:תקציב חינוך',
        topicSource: 'llm',
      },
    });
    const pending = await Pending.create({
      proposedKey: 'sector_budget',
      labelHe: 'תקציב מגזרי',
      labelEn: 'Sector budget',
      rawLabels: ['other:תקציב חינוך'],
    });
    await approvePendingTopic({
      Message,
      Topic,
      Pending,
      pendingId: String(pending._id),
      rewrite: true,
    });
    const inserted = (await Topic.findOne({ key: 'sector_budget' }).lean()) as {
      key: string;
      active: boolean;
    } | null;
    expect(inserted).toBeTruthy();
    expect(inserted!.active).toBe(true);

    const msg = (await Message.findOne({ messageId: 'm-rewrite' }).lean()) as {
      feedback: { topic: string; topicSource: string };
    } | null;
    expect(msg!.feedback.topic).toBe('sector_budget');
    expect(msg!.feedback.topicSource).toBe('taxonomy-retroactive');

    const stillPending = await Pending.findById(pending._id).lean();
    expect(stillPending).toBeNull();
  });

  it('does not rewrite messages when rewrite=false', async () => {
    await Message.create({
      messageId: 'm-no-rewrite',
      conversationId: 'c',
      user: 'u',
      isCreatedByUser: false,
      feedback: {
        rating: 'thumbsDown',
        topic: 'other:תקציב חינוך',
        topicSource: 'llm',
      },
    });
    const pending = await Pending.create({
      proposedKey: 'sector_budget_two',
      labelHe: 'תקציב מגזרי ב',
      labelEn: 'Sector budget B',
      rawLabels: ['other:תקציב חינוך'],
    });
    await approvePendingTopic({
      Message,
      Topic,
      Pending,
      pendingId: String(pending._id),
      rewrite: false,
    });
    const msg = (await Message.findOne({ messageId: 'm-no-rewrite' }).lean()) as {
      feedback: { topic: string };
    } | null;
    expect(msg!.feedback.topic).toBe('other:תקציב חינוך');
  });

  it('throws when pendingId not found', async () => {
    await expect(
      approvePendingTopic({
        Message,
        Topic,
        Pending,
        pendingId: new mongoose.Types.ObjectId().toString(),
        rewrite: false,
      }),
    ).rejects.toThrow(/not found/i);
  });
});
