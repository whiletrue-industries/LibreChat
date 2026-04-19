import type { Model } from 'mongoose';
import type { LlmAdapter } from './llmAdapter';
import { proposeClusters } from './proposeClusters';

export interface RunDiscoverInput {
  Message: Model<unknown>;
  PendingTopic: Model<unknown>;
  llm: LlmAdapter;
  sinceDays?: number;
  dryRun?: boolean;
}

export interface RunDiscoverResult {
  proposals: number;
  status: 'ok' | 'no-new-labels';
}

interface FeedbackMessageLite {
  messageId: string;
  feedback: { topic: string };
}

export async function runDiscover(input: RunDiscoverInput): Promise<RunDiscoverResult> {
  const sinceDays = input.sinceDays ?? 7;
  const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const rows = (await input.Message.find({
    'feedback.topicSource': 'llm',
    'feedback.topic': { $regex: /^other:/ },
    'feedback.topicClassifiedAt': { $gte: sinceDate },
  })
    .select('messageId feedback.topic')
    .lean()) as unknown as FeedbackMessageLite[];

  const byLabel = new Map<string, string[]>();
  for (const row of rows) {
    const label = row.feedback.topic;
    const list = byLabel.get(label) ?? [];
    list.push(row.messageId);
    byLabel.set(label, list);
  }

  const rawLabels = Array.from(byLabel.keys());
  if (rawLabels.length === 0) {
    return { proposals: 0, status: 'no-new-labels' };
  }

  const proposals = await proposeClusters(rawLabels, { llm: input.llm });

  if (!input.dryRun) {
    for (const proposal of proposals) {
      const exampleMessageIds = proposal.rawLabels
        .flatMap((label) => byLabel.get(label) ?? [])
        .slice(0, 5);
      await input.PendingTopic.create({
        proposedKey: proposal.proposedKey,
        labelHe: proposal.labelHe,
        labelEn: proposal.labelEn,
        rawLabels: proposal.rawLabels,
        exampleMessageIds,
        status: 'pending',
      });
    }
  }

  return { proposals: proposals.length, status: 'ok' };
}
