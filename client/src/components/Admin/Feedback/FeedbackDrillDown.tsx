import { useLocalize } from '~/hooks';
import type {
  AdminFeedbackDrillDownMessage,
  AdminFeedbackDrillDownResponse,
} from 'librechat-data-provider';

type Props = {
  topic: string | null;
  data: AdminFeedbackDrillDownResponse | undefined;
  loading: boolean;
  onClose: () => void;
};

export default function FeedbackDrillDown({ topic, data, loading, onClose }: Props) {
  const localize = useLocalize();
  if (!topic) {
    return null;
  }
  return (
    <aside
      role="dialog"
      aria-label={topic}
      className="fixed inset-y-0 end-0 z-40 flex w-full max-w-md flex-col border-s border-border-medium bg-surface-primary shadow-lg"
    >
      <header className="flex items-center justify-between border-b border-border-medium p-4">
        <h2 className="font-medium">{topic}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border-medium px-2 py-1 text-sm"
        >
          {localize('com_admin_feedback_drill_close')}
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        {loading && <div className="text-sm text-text-secondary">…</div>}
        {!loading && (data?.messages ?? []).length === 0 && (
          <div className="text-sm text-text-secondary">
            {localize('com_admin_feedback_empty')}
          </div>
        )}
        {(data?.messages ?? []).map((m: AdminFeedbackDrillDownMessage) => (
          <article key={m.messageId} className="mb-4 border-b border-border-medium pb-2">
            <p className="text-sm">{(m.text ?? '').slice(0, 500)}</p>
            {m.conversationId && (
              <a
                href={`/c/${m.conversationId}?highlight=${m.messageId}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-green-600 underline"
              >
                {localize('com_admin_feedback_drill_view_in_chat')}
              </a>
            )}
          </article>
        ))}
      </div>
    </aside>
  );
}
