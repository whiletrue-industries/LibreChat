export type StepKind =
  | 'chain'
  | 'llm'
  | 'tool'
  | 'tool_retrieve'
  | 'retrieve_stage'
  | 'embedding'
  | 'db'
  | 'http'
  | 'other'
  | 'user_message'
  | 'assistant_reply';

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface StageBreakdown {
  embed?: number;
  vector?: number;
  bm25?: number;
  rrf?: number;
  [key: string]: number | undefined;
}

export interface DocResult {
  score: number | null;
  name: string;
  chunkId?: string;
  cited?: boolean;
  /** Full document text returned by the retrieve tool, for the click-to-preview modal. */
  text?: string;
}

export interface TokenCounts {
  prompt?: number;
  completion?: number;
  total?: number;
}

export type Step = {
  kind: StepKind;
  spanId: string;
  name: string;
  tStartMs: number;       // ms from trace start
  durationMs: number;
  // per-kind enrichment (all optional for backward compat)
  model?: string;
  tokens?: TokenCounts;
  toolCalls?: ToolCall[];
  toolName?: string;
  args?: Record<string, unknown>;
  stages?: StageBreakdown;
  docs?: DocResult[];
  attrs: Record<string, unknown>;
};

export type TraceDTO = {
  traceId: string;
  env: 'staging' | 'prod' | 'local';
  totalMs: number;
  steps: Step[];
  spanCount: number;
};
