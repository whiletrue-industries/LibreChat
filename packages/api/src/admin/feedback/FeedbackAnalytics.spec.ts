import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { messageSchema } from '@librechat/data-schemas';
import { aggregateOverview } from './FeedbackAnalytics';

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
