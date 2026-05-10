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
        className={
          'cursor-pointer border-l-[3px] hover:bg-surface-primary-alt ' +
          (alert
            ? 'border-red-500 bg-red-50 dark:bg-red-950/20'
            : 'border-transparent')
        }
      >
        <td className="px-4 py-2.5 text-text-primary">
          {alert ? <span className="text-red-600 dark:text-red-400">⚠ </span> : null}
          <span className="font-semibold">{ctx.context}</span>
        </td>
        <td className="px-4 py-2.5 text-right tabular-nums text-text-primary">
          {ctx.document_count.toLocaleString()}
        </td>
        <td
          className={
            'px-4 py-2.5 text-right tabular-nums ' +
            (alert ? 'text-red-600 dark:text-red-400' : 'text-text-primary')
          }
        >
          {ctx.doc_count.toLocaleString()}
        </td>
        <td className="px-4 py-2.5">
          <Sparkline points={ctx.sparkline} />
        </td>
        <td className="px-4 py-2.5 text-sm text-text-secondary">
          {relativeAge(ctx.last_synced_at)}
        </td>
        <td className="w-8 text-center text-text-secondary">
          {expanded ? '▾' : '▸'}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} className="p-0">
            <SourceBreakdown context={ctx.context} />
          </td>
        </tr>
      )}
    </>
  );
};

export default SourceRow;
