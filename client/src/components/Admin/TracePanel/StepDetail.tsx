import React from 'react';
import type { Step } from './types';
import { LlmDetail } from './details/LlmDetail';
import { ToolRetrieveDetail } from './details/ToolRetrieveDetail';
import { ToolDetail } from './details/ToolDetail';
import { RawDetail } from './details/RawDetail';

interface Props {
  step: Step;
}

export function StepDetail({ step }: Props) {
  switch (step.kind) {
    case 'llm':
    case 'chain':
      return <LlmDetail step={step} />;

    case 'tool_retrieve':
      return <ToolRetrieveDetail step={step} />;

    case 'tool':
      return <ToolDetail step={step} />;

    case 'user_message': {
      const text = step.attrs?.['message.text'] as string | undefined;
      const chars = step.attrs?.['message.chars'] as number | undefined;
      const tokens = step.attrs?.['message.tokens'] as number | undefined;
      return (
        <div data-testid="trace-step-detail-user">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold" style={{ color: '#e6edf3' }}>
            user prompt
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 999,
              background: 'rgba(148,163,184,0.15)', color: '#94a3b8',
              textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500,
            }}>
              user_message
            </span>
          </h3>
          {text && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ color: '#6e7681', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                text
              </div>
              <pre
                dir="auto"
                style={{
                  margin: 0,
                  background: '#0d1117', border: '1px solid #21262d',
                  borderRadius: 6, padding: '8px 10px',
                  fontSize: 11.5, color: '#c9d1d9',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  maxHeight: 200, overflowY: 'auto',
                }}
              >
                {text}
              </pre>
            </div>
          )}
          {(chars != null || tokens != null) && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ color: '#6e7681', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                measurements
              </div>
              <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 14px' }}>
                {chars != null && (
                  <>
                    <dt style={{ color: '#8b949e', fontSize: 12 }}>chars</dt>
                    <dd style={{ margin: 0, color: '#e6edf3', fontVariantNumeric: 'tabular-nums' }}>{chars}</dd>
                  </>
                )}
                {tokens != null && (
                  <>
                    <dt style={{ color: '#8b949e', fontSize: 12 }}>tokens</dt>
                    <dd style={{ margin: 0, color: '#e6edf3', fontVariantNumeric: 'tabular-nums' }}>{tokens}</dd>
                  </>
                )}
              </dl>
            </div>
          )}
          {!text && (
            <RawDetail step={step} />
          )}
        </div>
      );
    }

    case 'assistant_reply': {
      const text = step.attrs?.['message.text'] as string | undefined;
      const tokens = step.attrs?.['message.tokens'] as number | undefined;
      return (
        <div data-testid="trace-step-detail-assistant">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold" style={{ color: '#e6edf3' }}>
            assistant reply
            <span style={{
              fontSize: 10, padding: '1px 6px', borderRadius: 999,
              background: 'rgba(148,163,184,0.15)', color: '#94a3b8',
              textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500,
            }}>
              assistant_reply
            </span>
          </h3>
          {text && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ color: '#6e7681', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                final text
              </div>
              <pre
                dir="auto"
                style={{
                  margin: 0,
                  background: '#0d1117', border: '1px solid #21262d',
                  borderRadius: 6, padding: '8px 10px',
                  fontSize: 11.5, color: '#c9d1d9',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  maxHeight: 300, overflowY: 'auto',
                }}
              >
                {text}
              </pre>
            </div>
          )}
          {tokens != null && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ color: '#6e7681', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                tokens
              </div>
              <span style={{ color: '#e6edf3', fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{tokens}</span>
            </div>
          )}
          {!text && (
            <RawDetail step={step} />
          )}
        </div>
      );
    }

    default:
      return <RawDetail step={step} />;
  }
}
