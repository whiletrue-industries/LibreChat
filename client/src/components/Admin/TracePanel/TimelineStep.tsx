import React from 'react';
import type { Step, StepKind } from './types';

interface Props {
  step: Step;
  index: number;
  totalMs: number;
  isActive: boolean;
  onClick: () => void;
}

/** Color stripe per kind */
const KIND_COLOR: Record<StepKind, string> = {
  chain: '#9ca3af',
  llm: '#a78bfa',
  tool: '#4ade80',
  tool_retrieve: '#4ade80',
  retrieve_stage: '#4ade80',
  embedding: '#60a5fa',
  db: '#fbbf24',
  http: '#6b7280',
  other: '#6b7280',
  user_message: '#94a3b8',
  assistant_reply: '#94a3b8',
};

/** Derive a human-readable label from the step, matching the mock */
function getLabel(step: Step): string {
  switch (step.kind) {
    case 'user_message':
      return 'user prompt';
    case 'assistant_reply':
      return 'assistant reply';
    case 'tool_retrieve': {
      // Try to extract context name from tool name or attrs
      const toolName = step.toolName ?? step.attrs?.['tool.name'] as string | undefined;
      if (toolName) {
        // "search_unified__legal_advisor_opinions__dev" → "legal_advisor_opinions"
        const parts = toolName.split('__');
        if (parts.length >= 2) return `retrieve · ${parts[1]}`;
      }
      return step.name || 'retrieve';
    }
    case 'llm':
      return step.name || 'LLM';
    case 'chain':
      return step.name || 'chain';
    case 'embedding':
      return step.name || 'embedding';
    case 'db':
      return step.name || 'db query';
    case 'http':
      return step.name || 'http';
    default:
      return step.name || step.kind;
  }
}

/** Sub-info line below the label */
function getSubInfo(step: Step): string | null {
  switch (step.kind) {
    case 'user_message': {
      const chars = step.attrs?.['message.chars'] as number | undefined;
      const tokens = step.attrs?.['message.tokens'] as number | undefined;
      const parts: string[] = [];
      if (chars != null) parts.push(`${chars} chars`);
      if (tokens != null) parts.push(`${tokens} tokens`);
      return parts.length > 0 ? parts.join(' · ') : null;
    }
    case 'assistant_reply': {
      const chars = step.attrs?.['message.chars'] as number | undefined;
      const tokens = step.attrs?.['message.tokens'] as number | undefined;
      const parts: string[] = [];
      if (chars != null) parts.push(`${chars} chars`);
      if (tokens != null) parts.push(`${tokens} tokens`);
      return parts.length > 0 ? parts.join(' · ') : null;
    }
    case 'llm': {
      const calls = step.toolCalls?.length ?? (step.attrs?.['llm.tool_calls.count'] as number | undefined);
      const toolsReg = step.attrs?.['llm.tools_registered'] as number | undefined;
      const parts: string[] = [];
      if (toolsReg != null) parts.push(`${toolsReg} tools registered`);
      if (calls != null) parts.push(`${calls} calls planned`);
      return parts.length > 0 ? parts.join(' · ') : null;
    }
    case 'chain': {
      const subSteps = step.attrs?.['chain.steps'] as number | undefined;
      return subSteps != null ? `${subSteps} sub-steps` : null;
    }
    case 'tool_retrieve': {
      const docs = step.docs ?? [];
      const cited = docs.filter(d => d.cited).length;
      if (docs.length > 0) {
        return `→ ${docs.length} docs${cited > 0 ? ` · ⭐ ${cited} later cited` : ''}`;
      }
      const docCount = step.attrs?.['retrieve.doc_count'] as number | undefined;
      return docCount != null ? `→ ${docCount} docs` : null;
    }
    case 'embedding':
      return step.attrs?.['embedding.model'] as string | undefined ?? null;
    case 'db':
      return step.attrs?.['db.operation'] as string | undefined ?? null;
    default:
      return null;
  }
}

export function TimelineStep({ step, index, totalMs, isActive, onClick }: Props) {
  const color = KIND_COLOR[step.kind] ?? '#6b7280';
  const label = getLabel(step);
  const subInfo = getSubInfo(step);
  const isEdge = step.kind === 'user_message' || step.kind === 'assistant_reply';

  // Duration bar width relative to total
  const barPct = totalMs > 0 ? Math.min(100, Math.round((step.durationMs / totalMs) * 100)) : 0;

  // Offset display
  const offsetSec = (step.tStartMs / 1000).toFixed(2);
  const offsetLabel = isEdge
    ? `${(step.tStartMs / 1000).toFixed(2)}s`
    : `+${offsetSec}s`;

  return (
    <div
      data-testid={`trace-step-${index}`}
      data-step-kind={step.kind}
      onClick={onClick}
      style={{
        padding: '10px 12px 10px 14px',
        cursor: 'pointer',
        position: 'relative',
        borderBottom: '1px solid #21262d',
        background: isActive ? 'rgba(91,157,255,0.07)' : 'transparent',
        transition: 'background 0.1s ease',
      }}
      onMouseEnter={e => {
        if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.02)';
      }}
      onMouseLeave={e => {
        if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
      }}
    >
      {/* Colored left stripe */}
      <div
        style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: 3, background: color, borderRadius: '0 2px 2px 0',
        }}
      />

      {/* Row 1: step number + label + time offset */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ color: '#6e7681', fontSize: 11, minWidth: 16 }}>
          {isEdge ? '·' : String(index)}
        </span>
        <span
          style={{
            color: '#e6edf3', fontWeight: 500, fontSize: 13, flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
          dir="auto"
        >
          {label}
        </span>
        <span style={{ color: '#6e7681', fontSize: 11, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
          {offsetLabel}
        </span>
      </div>

      {/* Row 2: sub-info */}
      {subInfo && (
        <div style={{ color: '#8b949e', fontSize: 11.5, marginTop: 3, paddingLeft: 24 }} dir="auto">
          {subInfo}
        </div>
      )}

      {/* Duration bar (only for non-edge steps) */}
      {!isEdge && barPct > 0 && (
        <div style={{ marginTop: 6, paddingLeft: 24 }}>
          <div
            style={{
              height: 3, background: '#2a3340', borderRadius: 2,
              position: 'relative', overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute', left: 0, top: 0, bottom: 0,
                width: `${barPct}%`,
                background: color, borderRadius: 2,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
