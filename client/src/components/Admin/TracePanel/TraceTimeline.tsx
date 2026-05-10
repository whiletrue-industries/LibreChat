import React, { useState, useCallback } from 'react';
import type { TraceDTO, Step } from './types';
import { TimelineStep } from './TimelineStep';
import { StepDetail } from './StepDetail';

interface Props {
  trace: TraceDTO;
  onClose: () => void;
}

function computeSummary(steps: Step[]) {
  let toolCount = 0;
  let docCount = 0;
  let citedCount = 0;

  for (const s of steps) {
    if (s.kind === 'tool' || s.kind === 'tool_retrieve') {
      toolCount++;
    }
    if (s.kind === 'tool_retrieve' && s.docs) {
      docCount += s.docs.length;
      citedCount += s.docs.filter(d => d.cited).length;
    }
  }

  return { toolCount, docCount, citedCount };
}

function copyToClipboard(text: string) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {/* ignore */});
  }
}

export function TraceTimeline({ trace, onClose }: Props) {
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const { toolCount, docCount, citedCount } = computeSummary(trace.steps);

  const totalSec = (trace.totalMs / 1000).toFixed(2);
  const traceIdShort = trace.traceId.slice(0, 12);
  const env = trace.env;

  const handleStepClick = useCallback((i: number) => {
    setActiveIndex(i);
  }, []);

  const activeStep = trace.steps[activeIndex] ?? null;

  return (
    <div
      data-testid="admin-trace-panel"
      style={{
        marginTop: 10,
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: 10,
        overflow: 'hidden',
        boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
      }}
    >
      {/* Panel header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
          padding: '10px 14px',
          background: '#1f2630',
          borderBottom: '1px solid #30363d',
        }}
      >
        <span style={{ color: '#8b949e', fontSize: 12.5 }}>
          <strong style={{ color: '#e6edf3', fontWeight: 600 }}>TRACE</strong>{' '}
          <code
            style={{
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              fontSize: 11.5, direction: 'ltr', unicodeBidi: 'isolate',
            }}
          >
            {traceIdShort}&hellip;
          </code>
        </span>
        <span style={{ color: '#8b949e', fontSize: 12.5 }}>
          total <strong style={{ color: '#e6edf3' }}>{totalSec}s</strong>
        </span>
        {toolCount > 0 && (
          <span style={{ color: '#8b949e', fontSize: 12.5 }}>
            <strong style={{ color: '#e6edf3' }}>{toolCount}</strong> tools
          </span>
        )}
        {docCount > 0 && (
          <span style={{ color: '#8b949e', fontSize: 12.5 }}>
            <strong style={{ color: '#e6edf3' }}>{docCount}</strong> docs
            {citedCount > 0 && (
              <>
                {' · '}
                <strong style={{ color: '#facc15' }}>{citedCount} cited</strong>
              </>
            )}
          </span>
        )}
        <span>
          <span
            style={{
              display: 'inline-block', padding: '1px 7px', borderRadius: 999,
              fontSize: 10.5,
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              background: '#2a3340', color: '#8b949e',
              border: '1px solid #30363d',
            }}
          >
            env={env}
          </span>
        </span>

        {/* Actions */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button
            onClick={() => copyToClipboard(trace.traceId)}
            title="copy trace id"
            style={{
              background: 'transparent', border: '1px solid #30363d',
              color: '#8b949e', padding: '3px 9px', borderRadius: 6,
              fontSize: 11.5, cursor: 'pointer',
            }}
          >
            copy id
          </button>
          <button
            data-testid="admin-trace-close"
            onClick={onClose}
            title="close"
            style={{
              background: 'transparent', border: '1px solid #30363d',
              color: '#8b949e', padding: '3px 9px', borderRadius: 6,
              fontSize: 11.5, cursor: 'pointer',
            }}
          >
            &#x2715;
          </button>
        </div>
      </div>

      {/* Body: two-pane layout */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '320px 1fr',
          minHeight: 440,
          maxHeight: '70vh',
        }}
      >
        {/* LEFT RAIL: timeline */}
        <div
          data-testid="trace-step-list"
          style={{
            borderRight: '1px solid #30363d',
            overflowY: 'auto',
            background: 'linear-gradient(180deg, #161b22 0%, #0d1117 100%)',
          }}
        >
          {trace.steps.map((step, i) => (
            <TimelineStep
              key={step.spanId}
              step={step}
              index={i}
              totalMs={trace.totalMs}
              isActive={i === activeIndex}
              onClick={() => handleStepClick(i)}
            />
          ))}
        </div>

        {/* RIGHT PANE: step detail */}
        <div
          data-testid="trace-detail-pane"
          style={{
            padding: '16px 20px',
            overflowY: 'auto',
            background: '#161b22',
          }}
        >
          {activeStep ? (
            <StepDetail step={activeStep} />
          ) : (
            <div style={{ color: '#8b949e', fontSize: 13 }}>
              Select a step to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
