import { useLocalize } from '~/hooks';
import type { AdminFeedbackTimePoint } from 'librechat-data-provider';

type Props = { points: AdminFeedbackTimePoint[] };

type SeriesPoint = {
  date: string;
  feedbackRate: number;
  positivePct: number;
};

const CHART_W = 600;
const CHART_H = 200;
const PAD = { top: 10, right: 16, bottom: 28, left: 36 };
const INNER_W = CHART_W - PAD.left - PAD.right;
const INNER_H = CHART_H - PAD.top - PAD.bottom;

function toPolyline(points: SeriesPoint[], key: keyof Pick<SeriesPoint, 'feedbackRate' | 'positivePct'>): string {
  const n = points.length;
  if (n === 0) {
    return '';
  }
  return points
    .map((p, i) => {
      const x = n === 1 ? INNER_W / 2 : (i / (n - 1)) * INNER_W;
      const y = INNER_H - (p[key] / 100) * INNER_H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function yTicks(): number[] {
  return [0, 25, 50, 75, 100];
}

export default function FeedbackTimeSeries({ points }: Props) {
  const localize = useLocalize();

  const series: SeriesPoint[] = points.map((p) => ({
    date: p.date,
    feedbackRate: p.total > 0 ? Number(((p.withFeedback / p.total) * 100).toFixed(1)) : 0,
    positivePct:
      p.withFeedback > 0 ? Number(((p.up / p.withFeedback) * 100).toFixed(1)) : 0,
  }));

  if (series.length === 0) {
    return (
      <div
        role="status"
        className="mb-6 rounded-lg border border-border-medium p-4 text-center text-sm text-text-secondary"
      >
        {localize('com_admin_feedback_empty')}
      </div>
    );
  }

  const n = series.length;
  const xLabelStep = Math.max(1, Math.floor(n / 6));

  return (
    <figure
      aria-label={`${localize('com_admin_feedback_kpi_feedback_rate')} / ${localize('com_admin_feedback_kpi_positive_pct')}`}
      className="mb-6 rounded-lg border border-border-medium p-4"
    >
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        role="img"
        aria-hidden="true"
        className="w-full"
        style={{ height: `${CHART_H}px` }}
      >
        <g transform={`translate(${PAD.left},${PAD.top})`}>
          {yTicks().map((tick) => {
            const y = INNER_H - (tick / 100) * INNER_H;
            return (
              <g key={tick}>
                <line
                  x1={0}
                  y1={y}
                  x2={INNER_W}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity={0.1}
                  strokeWidth={1}
                />
                <text
                  x={-4}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={10}
                  fill="currentColor"
                  fillOpacity={0.5}
                >
                  {tick}%
                </text>
              </g>
            );
          })}

          {series.map((p, i) => {
            if (i % xLabelStep !== 0) {
              return null;
            }
            const x = n === 1 ? INNER_W / 2 : (i / (n - 1)) * INNER_W;
            return (
              <text
                key={p.date}
                x={x}
                y={INNER_H + 16}
                textAnchor="middle"
                fontSize={10}
                fill="currentColor"
                fillOpacity={0.5}
              >
                {p.date.slice(5)}
              </text>
            );
          })}

          <polyline
            points={toPolyline(series, 'feedbackRate')}
            fill="none"
            stroke="#10a37f"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <polyline
            points={toPolyline(series, 'positivePct')}
            fill="none"
            stroke="#818181"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </g>
      </svg>

      <figcaption className="mt-2 flex gap-4 text-xs text-text-secondary">
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-2 w-4 rounded" style={{ background: '#10a37f' }} />
          {localize('com_admin_feedback_kpi_feedback_rate')}
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-2 w-4 rounded" style={{ background: '#818181' }} />
          {localize('com_admin_feedback_kpi_positive_pct')}
        </span>
      </figcaption>
    </figure>
  );
}
