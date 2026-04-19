import { useMemo } from 'react';
import { useLocalize } from '~/hooks';
import type { AdminFeedbackTopicRow } from 'librechat-data-provider';

type Props = {
  rows: AdminFeedbackTopicRow[];
  onSelect: (topic: string) => void;
};

function Sparkline({ points }: { points: number[] }) {
  if (points.length === 0) {
    return null;
  }
  const max = Math.max(1, ...points);
  const w = 60;
  const h = 18;
  const step = w / Math.max(1, points.length - 1);
  const path = points
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - (p / max) * h).toFixed(1)}`,
    )
    .join(' ');
  return (
    <svg width={w} height={h} aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export default function TopicTable({ rows, onSelect }: Props) {
  const localize = useLocalize();
  const sorted = useMemo(() => [...rows].sort((a, b) => b.total - a.total), [rows]);
  if (sorted.length === 0) {
    return (
      <div className="mb-6 rounded-lg border border-border-medium bg-surface-primary-alt p-4 text-center text-sm text-text-secondary">
        {localize('com_admin_feedback_empty')}
      </div>
    );
  }
  return (
    <div className="mb-6 overflow-hidden rounded-lg border border-border-medium bg-surface-primary-alt text-text-primary">
      <table className="w-full text-sm">
        <thead className="bg-surface-tertiary">
          <tr>
            <th className="p-2 text-start">{localize('com_admin_feedback_topic')}</th>
            <th className="p-2 text-end">{localize('com_admin_feedback_kpi_total')}</th>
            <th className="p-2 text-end">{localize('com_admin_feedback_kpi_feedback_rate')}</th>
            <th className="p-2 text-end">{localize('com_admin_feedback_kpi_positive_pct')}</th>
            <th className="p-2 text-end">{localize('com_admin_feedback_topic_sparkline')}</th>
            <th className="p-2 text-end">{localize('com_admin_feedback_topic_last_down')}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={row.topic}
              onClick={() => onSelect(row.topic)}
              className="cursor-pointer border-t border-border-medium hover:bg-surface-hover"
            >
              <td className="p-2">{row.topic}</td>
              <td className="p-2 text-end">{row.total}</td>
              <td className="p-2 text-end">
                {row.total > 0 ? Math.round((row.withFeedback / row.total) * 100) : 0}%
              </td>
              <td className="p-2 text-end">
                {row.positivePct === null ? '—' : `${row.positivePct}%`}
              </td>
              <td className="p-2 text-end">
                <Sparkline points={[row.withFeedback]} />
              </td>
              <td className="p-2 text-end">
                {row.lastThumbsDownAt ? new Date(row.lastThumbsDownAt).toLocaleString() : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
