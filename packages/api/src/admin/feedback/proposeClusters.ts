import type { LlmAdapter } from './llmAdapter';

export interface ProposedCluster {
  proposedKey: string;
  labelHe: string;
  labelEn: string;
  rawLabels: string[];
}

export interface ProposeClustersDeps {
  llm: LlmAdapter;
}

export async function proposeClusters(
  rawLabels: string[],
  deps: ProposeClustersDeps,
): Promise<ProposedCluster[]> {
  if (rawLabels.length === 0) {
    return [];
  }
  const unique = Array.from(new Set(rawLabels));
  const prompt = buildPrompt(unique);
  const raw = await deps.llm.classify(prompt, []);
  return parseResponse(raw);
}

function buildPrompt(labels: string[]): string {
  return [
    'Here are Hebrew topic labels from an AI system.',
    'Cluster synonyms into a small canonical set. For each cluster:',
    '- proposedKey: snake_case ASCII, 2-3 words',
    '- labelHe: canonical Hebrew label',
    '- labelEn: short English label',
    '- rawLabels: the raw inputs covered',
    'Return ONLY a JSON array. No prose.',
    '',
    'Labels:',
    ...labels.map((l, i) => `${i + 1}. ${l}`),
  ].join('\n');
}

function parseResponse(raw: string): ProposedCluster[] {
  const trimmed = raw.trim().replace(/^```json/, '').replace(/```$/, '').trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error('expected array');
    }
    return parsed.map((item) => validate(item));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`malformed LLM JSON response: ${message}`);
  }
}

function validate(item: unknown): ProposedCluster {
  if (!item || typeof item !== 'object') {
    throw new Error('cluster not an object');
  }
  const obj = item as Record<string, unknown>;
  const { proposedKey, labelHe, labelEn, rawLabels } = obj;
  if (
    typeof proposedKey !== 'string' ||
    typeof labelHe !== 'string' ||
    typeof labelEn !== 'string' ||
    !Array.isArray(rawLabels) ||
    !rawLabels.every((l) => typeof l === 'string')
  ) {
    throw new Error('cluster fields missing or wrong type');
  }
  return { proposedKey, labelHe, labelEn, rawLabels };
}
