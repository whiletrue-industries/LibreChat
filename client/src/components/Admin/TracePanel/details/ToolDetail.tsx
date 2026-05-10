import React from 'react';
import type { Step } from '../types';

interface Props {
  step: Step;
}

const FIELD_LABEL_STYLE: React.CSSProperties = {
  color: '#6e7681', fontSize: 11, textTransform: 'uppercase',
  letterSpacing: '0.08em', marginBottom: 4,
};

const CODE_STYLE: React.CSSProperties = {
  fontFamily: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  fontSize: 12,
};

const PILL_TOOL_STYLE: React.CSSProperties = {
  fontSize: 10, padding: '1px 6px', borderRadius: 999,
  background: '#103024', color: '#6ee7b7',
  textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500,
};

export function ToolDetail({ step }: Props) {
  const args = step.args ?? {};
  const hasArgs = Object.keys(args).length > 0;
  const toolName = step.toolName ?? step.attrs?.['tool.name'] as string | undefined;
  const response = step.attrs?.['tool.response'] ?? step.attrs?.['tool.result'];

  return (
    <div data-testid="trace-step-detail-tool">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold" style={{ color: '#e6edf3' }}>
        {step.name}
        <span style={PILL_TOOL_STYLE}>tool</span>
      </h3>

      {toolName && (
        <div style={{ marginBottom: 14 }}>
          <div style={FIELD_LABEL_STYLE}>tool</div>
          <div style={{ ...CODE_STYLE, color: '#e6edf3' }} dir="ltr">{toolName}</div>
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <div style={FIELD_LABEL_STYLE}>args</div>
        <pre
          dir="ltr"
          style={{
            margin: 0,
            background: '#0d1117', border: '1px solid #21262d',
            borderRadius: 6, padding: '8px 10px',
            fontSize: 11.5, color: '#c9d1d9',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            maxHeight: 240, overflowY: 'auto',
          }}
        >
          {hasArgs ? JSON.stringify(args, null, 2) : '{}'}
        </pre>
      </div>

      {response !== undefined && (
        <div style={{ marginBottom: 14 }}>
          <div style={FIELD_LABEL_STYLE}>response</div>
          <pre
            dir="auto"
            style={{
              margin: 0,
              background: '#0d1117', border: '1px solid #21262d',
              borderRadius: 6, padding: '8px 10px',
              fontSize: 11.5, color: '#c9d1d9',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              maxHeight: 240, overflowY: 'auto',
            }}
          >
            {typeof response === 'string' ? response : JSON.stringify(response, null, 2)}
          </pre>
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <div style={FIELD_LABEL_STYLE}>duration</div>
        <div style={{ color: '#e6edf3', fontSize: 12 }}>{step.durationMs.toLocaleString()} ms</div>
      </div>
    </div>
  );
}
