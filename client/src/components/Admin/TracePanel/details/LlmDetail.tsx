import React, { useState } from 'react';
import type { Step } from '../types';

interface Props {
  step: Step;
}

const PILL_LLM_STYLE: React.CSSProperties = {
  fontSize: 10, padding: '1px 6px', borderRadius: 999,
  background: '#2a1d4a', color: '#c4b5fd',
  textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500,
};

const FIELD_LABEL_STYLE: React.CSSProperties = {
  color: '#6e7681', fontSize: 11, textTransform: 'uppercase',
  letterSpacing: '0.08em', marginBottom: 4,
};

const KV_TERM_STYLE: React.CSSProperties = {
  color: '#8b949e', fontSize: 12,
};

const KV_DEF_STYLE: React.CSSProperties = {
  color: '#e6edf3', fontVariantNumeric: 'tabular-nums',
};

const CODE_STYLE: React.CSSProperties = {
  fontFamily: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  fontSize: 12,
};

export function LlmDetail({ step }: Props) {
  const [showArgs, setShowArgs] = useState<number | null>(null);

  const kindLabel = step.kind === 'llm' ? 'llm' : 'chain';
  const isLlm = step.kind === 'llm';

  const toolCalls = step.toolCalls ?? [];
  const tokens = step.tokens;
  const model = step.model ?? (step.attrs?.['llm.model'] as string | undefined);
  const finishReason = step.attrs?.['llm.finish_reason'] as string | undefined;

  return (
    <div data-testid="trace-step-detail-llm">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold" style={{ color: '#e6edf3' }}>
        {step.name}
        <span style={PILL_LLM_STYLE}>{kindLabel}</span>
      </h3>

      {/* Model */}
      {model && (
        <div style={{ marginBottom: 14 }}>
          <div style={FIELD_LABEL_STYLE}>model</div>
          <div style={{ ...CODE_STYLE, color: '#e6edf3' }} dir="ltr">{model}</div>
        </div>
      )}

      {/* Token breakdown */}
      {isLlm && tokens && (
        <div style={{ marginBottom: 14 }}>
          <div style={FIELD_LABEL_STYLE}>tokens</div>
          <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 14px' }}>
            {tokens.prompt != null && (
              <>
                <dt style={KV_TERM_STYLE}>prompt</dt>
                <dd style={{ ...KV_DEF_STYLE, margin: 0 }}>{tokens.prompt.toLocaleString()}</dd>
              </>
            )}
            {tokens.completion != null && (
              <>
                <dt style={KV_TERM_STYLE}>completion</dt>
                <dd style={{ ...KV_DEF_STYLE, margin: 0 }}>{tokens.completion.toLocaleString()}</dd>
              </>
            )}
            {tokens.total != null && (
              <>
                <dt style={KV_TERM_STYLE}>total</dt>
                <dd style={{ ...KV_DEF_STYLE, margin: 0 }}>{tokens.total.toLocaleString()}</dd>
              </>
            )}
            {finishReason && (
              <>
                <dt style={KV_TERM_STYLE}>finish reason</dt>
                <dd style={{ ...KV_DEF_STYLE, margin: 0 }}>
                  <span style={{
                    display: 'inline-block', padding: '1px 7px', borderRadius: 999,
                    fontSize: 10, fontFamily: CODE_STYLE.fontFamily,
                    background: '#2a3340', color: '#8b949e', border: '1px solid #30363d',
                  }}>
                    {finishReason}
                  </span>
                </dd>
              </>
            )}
            <dt style={KV_TERM_STYLE}>duration</dt>
            <dd style={{ ...KV_DEF_STYLE, margin: 0 }}>{step.durationMs.toLocaleString()} ms</dd>
          </dl>
        </div>
      )}

      {/* Tool calls */}
      {toolCalls.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={FIELD_LABEL_STYLE}>tool calls ({toolCalls.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {toolCalls.map((tc, i) => (
              <div
                key={i}
                style={{
                  display: 'flex', flexDirection: 'column', gap: 4,
                  padding: '6px 10px',
                  background: '#0d1117', border: '1px solid #21262d',
                  borderRadius: 6, cursor: 'pointer',
                }}
                onClick={() => setShowArgs(showArgs === i ? null : i)}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ ...CODE_STYLE, color: '#4ade80', fontSize: 12 }}>{tc.name}</span>
                  <span style={{ color: '#6e7681', fontSize: 11 }}>
                    {showArgs === i ? '▴ hide args' : '▾ show args'}
                  </span>
                </div>
                {showArgs === i && (
                  <pre
                    dir="ltr"
                    style={{
                      margin: 0, marginTop: 4, padding: '6px 8px',
                      background: '#161b22', borderRadius: 4,
                      fontSize: 11.5, color: '#c9d1d9',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      maxHeight: 200, overflowY: 'auto',
                    }}
                  >
                    {JSON.stringify(tc.args, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Raw attrs fallback if no enrichment available */}
      {!model && toolCalls.length === 0 && !tokens && (
        <div style={{ marginBottom: 14 }}>
          <div style={FIELD_LABEL_STYLE}>attributes</div>
          <pre
            dir="ltr"
            style={{
              margin: 0,
              background: '#0d1117', border: '1px solid #21262d',
              borderRadius: 6, padding: '8px 10px',
              fontSize: 11.5, color: '#c9d1d9',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              maxHeight: 300, overflowY: 'auto',
            }}
          >
            {JSON.stringify(step.attrs, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
