import React, { useState } from 'react';
import type { AdminSourcesContext } from 'librechat-data-provider';
import Sparkline from './Sparkline';
import SourceBreakdown from './SourceBreakdown';

type Props = { ctx: AdminSourcesContext };

const relativeAge = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
};

const SourceRow: React.FC<Props> = ({ ctx }) => {
  const [expanded, setExpanded] = useState(false);
  const alert = ctx.drift_alert;

  return (
    <>
      <tr
        onClick={() => setExpanded((s) => !s)}
        style={{
          cursor: 'pointer',
          borderLeft: alert ? '3px solid #c0392b' : '3px solid transparent',
          background: alert ? 'rgba(192,57,43,0.04)' : undefined,
        }}
      >
        <td style={{ padding: '10px 14px' }}>
          {alert ? '⚠ ' : ''}<span style={{ fontWeight: 600 }}>{ctx.context}</span>
        </td>
        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: alert ? '#c0392b' : undefined }}>
          {ctx.doc_count.toLocaleString()}
        </td>
        <td><Sparkline points={ctx.sparkline} /></td>
        <td style={{ fontSize: 12, opacity: 0.8 }}>{relativeAge(ctx.last_synced_at)}</td>
        <td style={{ textAlign: 'center', opacity: 0.6 }}>{expanded ? '▾' : '▸'}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={5} style={{ padding: 0 }}>
            <SourceBreakdown context={ctx.context} />
          </td>
        </tr>
      )}
    </>
  );
};

export default SourceRow;
