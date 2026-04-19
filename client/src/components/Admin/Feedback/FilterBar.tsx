import { useLocalize } from '~/hooks';
import type { AdminFeedbackOverviewFilter } from 'librechat-data-provider';

type Props = {
  value: AdminFeedbackOverviewFilter;
  onChange: (next: AdminFeedbackOverviewFilter) => void;
  onRefresh: () => void;
};

const RANGE_OPTIONS: Array<{ days: number; labelKey: 'com_admin_feedback_range_7' | 'com_admin_feedback_range_30' | 'com_admin_feedback_range_90' }> = [
  { days: 7, labelKey: 'com_admin_feedback_range_7' },
  { days: 30, labelKey: 'com_admin_feedback_range_30' },
  { days: 90, labelKey: 'com_admin_feedback_range_90' },
];

export default function FilterBar({ value, onChange, onRefresh }: Props) {
  const localize = useLocalize();

  const selectRange = (days: number) => {
    const until = new Date();
    const since = new Date(until);
    since.setDate(until.getDate() - days);
    onChange({ ...value, since: since.toISOString(), until: until.toISOString() });
  };

  return (
    <div
      role="toolbar"
      aria-label={localize('com_admin_feedback_filter_date_range')}
      className="mb-4 flex flex-wrap items-center gap-2"
    >
      {RANGE_OPTIONS.map((opt) => (
        <button
          key={opt.days}
          type="button"
          onClick={() => selectRange(opt.days)}
          className="rounded-md border border-border-medium px-3 py-1 text-sm"
        >
          {localize(opt.labelKey)}
        </button>
      ))}
      <button
        type="button"
        onClick={onRefresh}
        className="ms-auto rounded-md bg-green-500 px-3 py-1 text-sm text-white"
      >
        {localize('com_admin_feedback_filter_refresh')}
      </button>
    </div>
  );
}
