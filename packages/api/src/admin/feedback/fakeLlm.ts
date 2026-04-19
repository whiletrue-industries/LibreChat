import type { LlmAdapter } from './llmAdapter';

export type FakeLlmResponses = Record<string, string> & { default?: string };

export function buildFakeLlm(responses: FakeLlmResponses): LlmAdapter {
  return {
    async classify(prompt: string): Promise<string> {
      for (const [prefix, result] of Object.entries(responses)) {
        if (prefix === 'default') {
          continue;
        }
        if (prompt.includes(prefix)) {
          return result;
        }
      }
      return responses.default ?? 'other:unknown';
    },
  };
}
