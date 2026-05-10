import React from 'react';
import type { Step } from '../types';

interface Props {
  step: Step;
}

export function RawDetail({ step }: Props) {
  return (
    <div data-testid="trace-step-detail-raw">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
        {step.name}
        <span
          style={{
            fontSize: 10, padding: '1px 6px', borderRadius: 999,
            background: 'rgba(156,163,175,0.15)', color: '#9ca3af',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}
        >
          {step.kind}
        </span>
      </h3>
      <div className="mb-2 text-xs uppercase tracking-wider" style={{ color: '#6e7681' }}>
        raw attributes
      </div>
      <pre
        style={{
          background: '#0d1117',
          border: '1px solid #21262d',
          borderRadius: 6,
          padding: '8px 10px',
          color: '#c9d1d9',
          fontSize: 11.5,
          overflowX: 'auto',
          maxHeight: 400,
          overflowY: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
        dir="ltr"
      >
        {JSON.stringify(step.attrs, null, 2)}
      </pre>
    </div>
  );
}
