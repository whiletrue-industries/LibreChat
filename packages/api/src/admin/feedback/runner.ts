import type { Model } from 'mongoose';
import type { LlmAdapter } from './llmAdapter';
import { classifyOne } from './classifyOne';
import { initialTaxonomy } from './taxonomy';

const KNOWN_KEYS = initialTaxonomy.map((entry) => entry.key);
export const BATCH_SLEEP_MS = 3000;

export interface RunInput {
  Message: Model<unknown>;
  llm: LlmAdapter;
  limit: number;
  dryRun: boolean;
  sleepMs?: number;
}

export interface RunStats {
  processed: number;
  taxonomyHits: number;
  llmCalls: number;
  errors: number;
}

interface MessageLike {
  _id: unknown;
  messageId: string;
  parentMessageId?: string | null;
  text?: string;
  content?: Array<{ text?: string }>;
}

function logJson(obj: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), ...obj })}\n`);
}

async function resolveUserText(Message: Model<unknown>, assistantMsg: MessageLike): Promise<string> {
  if (!assistantMsg.parentMessageId) {
    return '';
  }
  const parent = (await Message.findOne({
    messageId: assistantMsg.parentMessageId,
  }).lean()) as unknown as MessageLike | null;
  if (!parent) {
    return '';
  }
  if (typeof parent.text === 'string' && parent.text.trim().length > 0) {
    return parent.text;
  }
  if (Array.isArray(parent.content)) {
    return parent.content
      .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
      .join('\n');
  }
  return '';
}

export async function run(input: RunInput): Promise<RunStats> {
  const filter = {
    isCreatedByUser: false,
    feedback: { $exists: true },
    'feedback.topic': { $exists: false },
  };
  const docs = (await input.Message.find(filter).limit(input.limit).lean()) as unknown as MessageLike[];
  const stats: RunStats = { processed: 0, taxonomyHits: 0, llmCalls: 0, errors: 0 };

  for (const msg of docs) {
    try {
      const userText = await resolveUserText(input.Message, msg);
      const { topic, source, rawLlmResponse } = await classifyOne(
        { userText, knownKeys: KNOWN_KEYS },
        { llm: input.llm },
      );

      if (source === 'taxonomy') {
        stats.taxonomyHits += 1;
      } else {
        stats.llmCalls += 1;
      }

      if (!input.dryRun) {
        await input.Message.updateOne(
          { _id: msg._id },
          {
            $set: {
              'feedback.topic': topic,
              'feedback.topicSource': source,
              'feedback.topicClassifiedAt': new Date(),
            },
          },
          { strict: false },
        );
      }

      stats.processed += 1;
      logJson({
        level: 'info',
        stage: 'classify',
        msgId: msg.messageId,
        topic,
        source,
        rawLlmResponse,
      });
    } catch (error) {
      stats.errors += 1;
      logJson({
        level: 'error',
        stage: 'classify',
        msgId: msg.messageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return stats;
}
