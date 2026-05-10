import React from 'react';
import type { Step, StageBreakdown, DocResult } from '../types';

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

function StageBar({ stages, totalMs }: { stages: StageBreakdown; totalMs: number }) {
  const stageEntries = Object.entries(stages).filter(
    ([, v]) => v !== undefined && v !== null,
  ) as [string, number][];

  const sum = stageEntries.reduce((acc, [, v]) => acc + v, 0) || 1;

  const stageLabels: Record<string, string> = {
    embed: 'embed.openai',
    vector: 'db.aurora.vector',
    bm25: 'db.aurora.bm25',
    rrf: 'rrf.fuse',
  };

  return (
    <div
      style={{
        background: '#0d1117', border: '1px solid #21262d',
        borderRadius: 6, padding: 10,
        display: 'flex', flexDirection: 'column', gap: 4,
      }}
    >
      {stageEntries.map(([key, val]) => {
        const pct = Math.round((val / sum) * 100);
        return (
          <div
            key={key}
            style={{
              display: 'grid',
              gridTemplateColumns: '110px 60px 1fr',
              gap: 8, alignItems: 'center', fontSize: 12.5,
            }}
          >
            <span style={{ ...CODE_STYLE, color: '#8b949e', fontSize: 12 }}>
              {stageLabels[key] ?? key}
            </span>
            <span style={{ color: '#e6edf3', fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
              {val} ms
            </span>
            <div
              style={{
                height: 6, background: '#2a3340', borderRadius: 3,
                position: 'relative', overflow: 'hidden',
              }}
            >
              <div
                data-testid={`retrieve-stage-bar-${key}`}
                style={{
                  position: 'absolute', left: 0, top: 0, bottom: 0,
                  width: `${pct}%`,
                  background: '#5b9dff',
                  borderRadius: 3,
                }}
              />
            </div>
          </div>
        );
      })}
      <div style={{ color: '#6e7681', fontSize: 11, marginTop: 4 }}>
        total {totalMs} ms
      </div>
    </div>
  );
}

function DocRow({ doc, index, onOpen }: { doc: DocResult; index: number; onOpen: (d: DocResult) => void }) {
  const clickable = !!doc.text;
  return (
    <div
      data-testid="retrieve-doc-row"
      data-cited={String(!!doc.cited)}
      onClick={clickable ? () => onOpen(doc) : undefined}
      title={clickable ? `Click to view full text · ${doc.name}` : doc.name}
      style={{
        padding: '8px 10px',
        display: 'grid',
        gridTemplateColumns: '24px 60px 1fr auto',
        gap: 10, alignItems: 'center', fontSize: 12.5,
        borderBottom: '1px solid #21262d',
        cursor: clickable ? 'pointer' : 'default',
        transition: 'background 0.12s ease',
      }}
      onMouseEnter={clickable ? (e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)'; } : undefined}
      onMouseLeave={clickable ? (e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; } : undefined}
    >
      <span style={{ color: doc.cited ? '#facc15' : '#6e7681', fontSize: 14, textAlign: 'center' }}>
        {doc.cited ? '⭐' : '·'}
      </span>
      <span
        style={{
          fontVariantNumeric: 'tabular-nums', color: '#8b949e',
          ...CODE_STYLE, fontSize: 11.5,
        }}
        dir="ltr"
      >
        {typeof doc.score === 'number' ? doc.score.toFixed(4) : '—'}
      </span>
      <span
        style={{ color: '#e6edf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        dir="auto"
      >
        {doc.name}
      </span>
      {clickable && (
        <span style={{ color: '#6e7681', fontSize: 11 }}>preview ↗</span>
      )}
    </div>
  );
}

function ChunkPreviewModal({ doc, onClose }: { doc: DocResult; onClose: () => void }) {
  // Lock body scroll while open + close on Esc.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      data-testid="chunk-preview-modal"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        style={{
          background: '#161b22', border: '1px solid #30363d',
          borderRadius: 10, width: 'min(720px, 92vw)',
          maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '12px 16px', borderBottom: '1px solid #30363d',
            display: 'flex', alignItems: 'center', gap: 10,
          }}
        >
          <span
            style={{ color: '#e6edf3', fontWeight: 500, flex: 1, fontSize: 13.5 }}
            dir="auto"
          >
            {doc.cited && <span style={{ color: '#facc15', marginRight: 6 }}>⭐</span>}
            {doc.name}
          </span>
          {typeof doc.score === 'number' && (
            <span style={{ color: '#8b949e', ...CODE_STYLE, fontSize: 11.5 }} dir="ltr">
              {doc.score.toFixed(4)}
            </span>
          )}
          <button
            data-testid="chunk-preview-close"
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none',
              color: '#8b949e', cursor: 'pointer', fontSize: 16, padding: '0 4px',
            }}
            aria-label="Close preview"
          >
            ✕
          </button>
        </div>
        <div
          data-testid="chunk-preview-text"
          style={{
            padding: '14px 16px', overflowY: 'auto',
            background: '#0d1117', color: '#e6edf3',
            fontSize: 13, lineHeight: 1.7,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            direction: 'rtl', textAlign: 'right',
          }}
        >
          {doc.text || '(no text in response preview)'}
        </div>
      </div>
    </div>
  );
}

export function ToolRetrieveDetail({ step }: Props) {
  const args = step.args ?? {};
  const hasArgs = Object.keys(args).length > 0;
  const toolName = step.toolName ?? step.attrs?.['tool.name'] as string | undefined;
  const stages = step.stages;
  const docs = step.docs ?? [];
  const [previewDoc, setPreviewDoc] = React.useState<DocResult | null>(null);

  const citedCount = docs.filter(d => d.cited).length;

  return (
    <div data-testid="trace-step-detail-retrieve">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold" style={{ color: '#e6edf3' }}>
        {step.name}
        <span style={PILL_TOOL_STYLE}>tool_retrieve</span>
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
            maxHeight: 200, overflowY: 'auto',
          }}
        >
          {hasArgs ? JSON.stringify(args, null, 2) : '{}'}
        </pre>
      </div>

      {stages && Object.keys(stages).length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={FIELD_LABEL_STYLE}>
            total time · {step.durationMs} ms
          </div>
          <StageBar stages={stages} totalMs={step.durationMs} />
        </div>
      )}

      {docs.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={FIELD_LABEL_STYLE}>
            docs returned ({docs.length}){citedCount > 0 ? ` · ⭐ ${citedCount} cited` : ''}
          </div>
          <div
            style={{
              background: '#0d1117', border: '1px solid #21262d',
              borderRadius: 6, overflow: 'hidden',
            }}
          >
            {docs.map((doc, i) => (
              <DocRow
                key={doc.chunkId ?? i}
                doc={doc}
                index={i}
                onOpen={setPreviewDoc}
              />
            ))}
          </div>
        </div>
      )}
      {previewDoc && (
        <ChunkPreviewModal doc={previewDoc} onClose={() => setPreviewDoc(null)} />
      )}
    </div>
  );
}
