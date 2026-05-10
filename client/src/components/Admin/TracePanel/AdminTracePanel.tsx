import React, { useState } from 'react';
import { useAuthContext } from '~/hooks/AuthContext';
import { useTraceFetch } from './useTraceFetch';
import { TraceTimeline } from './TraceTimeline';

interface TracedMessage {
  // TMessage.metadata is Record<string, unknown>; we access known fields via runtime casts
  metadata?: Record<string, unknown>;
}

export function AdminTracePanel({ message }: { message: TracedMessage }) {
  // CRITICAL: All hooks must be called unconditionally on every render to
  // satisfy the React rules of hooks (otherwise: minified React error #310).
  const { user, token } = useAuthContext();
  const [expanded, setExpanded] = useState(false);
  const traceId = message?.metadata?.phoenix_trace_id as string | undefined;
  const summary = message?.metadata?.phoenix_summary as
    | { totalMs?: number; toolCount?: number; docCount?: number; citedCount?: number }
    | undefined;
  const isAdmin = user?.role === 'ADMIN';
  const { data, isLoading, error } = useTraceFetch(traceId, expanded && isAdmin, token);

  // After all hooks: gate rendering. Non-admins or messages without a
  // trace_id render nothing.
  if (!isAdmin || !traceId) return null;

  return (
    <div data-testid="admin-trace-container" style={{ marginTop: 8 }}>
      {!expanded && (
        <button
          data-testid="admin-trace-pill"
          onClick={() => setExpanded(true)}
          title={`trace ${traceId}`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: '#1f2630', border: '1px solid #30363d',
            color: '#8b949e', padding: '4px 10px', borderRadius: 999,
            fontSize: 12, cursor: 'pointer', userSelect: 'none',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={e => {
            const el = e.currentTarget as HTMLButtonElement;
            el.style.color = '#e6edf3';
            el.style.borderColor = '#4a5468';
            el.style.background = '#2a3340';
          }}
          onMouseLeave={e => {
            const el = e.currentTarget as HTMLButtonElement;
            el.style.color = '#8b949e';
            el.style.borderColor = '#30363d';
            el.style.background = '#1f2630';
          }}
        >
          <span style={{ color: '#7dd3fc' }}>ⓘ</span>
          {' trace'}
          {summary?.totalMs != null && (
            <>
              <span style={{ color: '#6e7681' }}>·</span>
              <span>{(summary.totalMs / 1000).toFixed(1)}s</span>
            </>
          )}
          {summary?.toolCount != null && summary.toolCount > 0 && (
            <>
              <span style={{ color: '#6e7681' }}>·</span>
              <span>{summary.toolCount} tools</span>
            </>
          )}
          {summary?.docCount != null && summary.docCount > 0 && (
            <>
              <span style={{ color: '#6e7681' }}>·</span>
              <span>{summary.docCount} docs read</span>
            </>
          )}
          {summary?.citedCount != null && summary.citedCount > 0 && (
            <>
              <span style={{ color: '#6e7681' }}>·</span>
              <span style={{ color: '#facc15' }}>{summary.citedCount} cited</span>
            </>
          )}
          <span style={{ fontSize: 10, color: '#6e7681', marginLeft: 2 }}>▾</span>
        </button>
      )}

      {expanded && (
        <>
          {isLoading && (
            <div data-testid="trace-loading" style={{ marginTop: 8 }}>
              {/* Loading skeleton */}
              <div
                style={{
                  marginTop: 10, background: '#161b22',
                  border: '1px solid #30363d', borderRadius: 10, overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '10px 14px', background: '#1f2630',
                    borderBottom: '1px solid #30363d',
                  }}
                >
                  <span style={{ color: '#e6edf3', fontWeight: 600, fontSize: 12.5 }}>TRACE</span>
                  <code style={{ fontSize: 11.5, color: '#8b949e' }}>
                    {traceId.slice(0, 12)}&hellip;
                  </code>
                  <div style={{ marginLeft: 'auto' }}>
                    <button
                      data-testid="admin-trace-close"
                      onClick={() => setExpanded(false)}
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
                <div
                  style={{
                    display: 'grid', gridTemplateColumns: '320px 1fr',
                    minHeight: 220,
                  }}
                >
                  <div style={{ borderRight: '1px solid #30363d' }}>
                    {[...Array(6)].map((_, i) => (
                      <div
                        key={i}
                        style={{
                          height: 38, borderBottom: '1px solid #21262d',
                          position: 'relative', overflow: 'hidden',
                          background: '#161b22',
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute', inset: 0,
                            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.04), transparent)',
                            animation: 'shimmer 1.4s infinite',
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <div style={{ padding: 16, color: '#8b949e', fontSize: 13 }}>
                    Fetching trace…
                  </div>
                </div>
              </div>
            </div>
          )}

          {error != null && !isLoading && (
            <div
              data-testid="trace-error"
              style={{
                marginTop: 8, padding: '10px 14px',
                background: '#161b22', border: '1px solid #30363d',
                borderRadius: 10, color: '#ef4444', fontSize: 12.5,
                display: 'flex', alignItems: 'center', gap: 10,
              }}
            >
              <span>∅ trace not available: {String(error)}</span>
              <button
                data-testid="admin-trace-close"
                onClick={() => setExpanded(false)}
                style={{
                  marginLeft: 'auto', background: 'transparent',
                  border: '1px solid #30363d', color: '#8b949e',
                  padding: '3px 9px', borderRadius: 6, fontSize: 11.5, cursor: 'pointer',
                }}
              >
                &#x2715;
              </button>
            </div>
          )}

          {data && !isLoading && (
            <TraceTimeline trace={data} onClose={() => setExpanded(false)} />
          )}
        </>
      )}
    </div>
  );
}
