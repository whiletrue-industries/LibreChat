import type { LlmAdapter } from './llmAdapter';
import { matchTaxonomy } from './taxonomy';

export type ClassificationSource =
  | 'taxonomy'
  | 'llm'
  | 'llm-invalid'
  | 'taxonomy-retroactive';

export interface ClassificationResult {
  topic: string;
  source: ClassificationSource;
  rawLlmResponse?: string;
}

export interface ClassifyOneInput {
  userText: string;
  knownKeys: string[];
}

export interface ClassifyOneDeps {
  llm: LlmAdapter;
}

export async function classifyOne(
  input: ClassifyOneInput,
  deps: ClassifyOneDeps,
): Promise<ClassificationResult> {
  const { userText, knownKeys } = input;
  if (!userText?.trim()) {
    return { topic: 'unknown', source: 'taxonomy' };
  }
  const taxonomyHit = matchTaxonomy(userText);
  if (taxonomyHit) {
    return { topic: taxonomyHit, source: 'taxonomy' };
  }
  const raw = await deps.llm.classify(userText, knownKeys);
  if (knownKeys.includes(raw)) {
    return { topic: raw, source: 'llm' };
  }
  if (raw.startsWith('other:') && raw.length > 6) {
    return { topic: raw, source: 'llm' };
  }
  return { topic: 'unknown', source: 'llm-invalid', rawLlmResponse: raw };
}
