import { useLocalize } from '~/hooks';
import type { AdminFeedbackPending } from 'librechat-data-provider';

type Props = {
  pending: AdminFeedbackPending[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
};

export default function PendingTopicsQueue({ pending, onApprove, onReject }: Props) {
  const localize = useLocalize();
  if (pending.length === 0) {
    return null;
  }
  return (
    <div className="mb-6 rounded-lg border border-yellow-400/40 bg-yellow-50 p-4 dark:bg-yellow-900/10">
      <h3 className="mb-2 text-sm font-medium">{localize('com_admin_feedback_pending_header')}</h3>
      <ul className="space-y-2">
        {pending.map((p) => (
          <li key={p._id} className="flex items-center justify-between gap-3">
            <span>
              <strong>{p.labelHe}</strong> ({p.rawLabels.length} labels,{' '}
              {p.exampleMessageIds.length} example msgs)
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                onClick={() => onApprove(p._id)}
                className="rounded-md bg-green-500 px-3 py-1 text-sm text-white"
              >
                {localize('com_admin_feedback_pending_approve')}
              </button>
              <button
                type="button"
                onClick={() => onReject(p._id)}
                className="rounded-md border border-border-medium px-3 py-1 text-sm"
              >
                {localize('com_admin_feedback_pending_reject')}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
