import React from 'react';
import { useAdminSourceQuery } from '~/data-provider';
import Sparkline from './Sparkline';

type Props = { context: string };

const externalLink = (sourceId: string): string | null => {
  if (sourceId === 'lexicon' || sourceId === 'bk_csv' || sourceId === 'common-knowledge') {
    return null;
  }
  if (sourceId.startsWith('knesset_')) {
    return null;
  }
  return `https://he.wikisource.org/wiki/${encodeURIComponent(sourceId)}`;
};

const SourceBreakdown: React.FC<Props> = ({ context }) => {
  const { data, isLoading, error } = useAdminSourceQuery(context, { enabled: true });

  if (isLoading) {
    return <div style={{ padding: 14, opacity: 0.7 }}>loading…</div>;
  }
  if (error) {
    return <div style={{ padding: 14, color: '#c0392b' }}>error</div>;
  }
  if (!data || !data.context_summary) {
    return <div style={{ padding: 14 }}>no snapshots</div>;
  }

  return (
    <div style={{ padding: 14, background: 'rgba(127,127,127,0.04)' }}>
      <div style={{ marginBottom: 10 }}>
        <Sparkline points={data.context_summary.sparkline} width={500} height={64} />
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 90px 120px 70px 30px',
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.6px',
          opacity: 0.6,
          padding: '6px 0',
          borderBottom: '1px solid rgba(127,127,127,0.2)',
        }}
      >
        <div>Source</div>
        <div style={{ textAlign: 'right' }}>Docs</div>
        <div>Trend</div>
        <div style={{ textAlign: 'right' }}>7d Δ</div>
        <div></div>
      </div>
      {data.sources.map((s) => {
        const href = externalLink(s.source_id);
        const deltaColor = s.delta_7d > 0 ? '#1a7f37' : s.delta_7d < 0 ? '#c0392b' : '#888';
        return (
          <div
            key={s.source_id}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 90px 120px 70px 30px',
              padding: '8px 0',
              borderBottom: '1px solid rgba(127,127,127,0.12)',
              fontSize: 12,
              alignItems: 'center',
            }}
          >
            <div>{s.source_id}</div>
            <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {s.doc_count.toLocaleString()}
            </div>
            <div>
              <Sparkline points={s.sparkline} width={110} height={18} />
            </div>
            <div
              style={{
                textAlign: 'right',
                color: deltaColor,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {s.delta_7d >= 0 ? '+' : ''}
              {s.delta_7d}
            </div>
            <div>
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#2563eb' }}
                >
                  ↗
                </a>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default SourceBreakdown;
