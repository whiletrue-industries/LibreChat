import { useLocalize } from '~/hooks';
import type { AdminFeedbackKpis } from 'librechat-data-provider';

type Props = { kpis: AdminFeedbackKpis };

type KpiCard = {
  labelKey:
    | 'com_admin_feedback_kpi_total'
    | 'com_admin_feedback_kpi_feedback_rate'
    | 'com_admin_feedback_kpi_positive_pct'
    | 'com_admin_feedback_kpi_trend';
  value: string;
};

function fmt(value: number | null, suffix = ''): string {
  return value === null ? '—' : `${value}${suffix}`;
}

export default function KpiStrip({ kpis }: Props) {
  const localize = useLocalize();
  const cards: KpiCard[] = [
    { labelKey: 'com_admin_feedback_kpi_total', value: String(kpis.total) },
    { labelKey: 'com_admin_feedback_kpi_feedback_rate', value: fmt(kpis.feedbackRate, '%') },
    { labelKey: 'com_admin_feedback_kpi_positive_pct', value: fmt(kpis.positivePct, '%') },
    { labelKey: 'com_admin_feedback_kpi_trend', value: '—' },
  ];
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.labelKey}
          className="rounded-lg border border-border-medium p-4"
        >
          <div className="text-xs text-text-secondary">
            {localize(card.labelKey)}
          </div>
          <div className="mt-1 text-2xl font-semibold">{card.value}</div>
        </div>
      ))}
    </div>
  );
}
