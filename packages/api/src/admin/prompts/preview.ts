import type { AgentsClient } from './shadowAgent';
import { spawnOrReuseShadow } from './shadowAgent';

export interface PreviewAnswer {
  answer: string;
  toolCalls: unknown[];
}

export interface PreviewQuestionResult {
  text: string;
  current: PreviewAnswer;
  draft: PreviewAnswer;
  timedOut: boolean;
}

export interface PreviewOutput {
  shadowId: string;
  questions: PreviewQuestionResult[];
}

export interface RunPreviewInput {
  client: AgentsClient;
  liveAgentId: string;
  draftInstructions: string;
  questions: string[];
  timeoutMs: number;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export async function runPreview(input: RunPreviewInput): Promise<PreviewOutput> {
  const shadowId = await spawnOrReuseShadow({
    client: input.client,
    liveAgentId: input.liveAgentId,
    instructions: input.draftInstructions,
  });
  const results: PreviewQuestionResult[] = [];
  for (const q of input.questions) {
    const [curr, draft] = await Promise.all([
      withTimeout(input.client.chat(input.liveAgentId, q), input.timeoutMs),
      withTimeout(input.client.chat(shadowId, q), input.timeoutMs),
    ]);
    const timedOut = curr === null || draft === null;
    results.push({
      text: q,
      current: curr ?? { answer: '(timeout)', toolCalls: [] },
      draft: draft ?? { answer: '(timeout)', toolCalls: [] },
      timedOut,
    });
  }
  return { shadowId, questions: results };
}
