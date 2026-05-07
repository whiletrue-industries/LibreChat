import type { AdminPromptSnapshot } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

interface RestoreConfirmDialogProps {
  agentType: string;
  snapshot: AdminPromptSnapshot;
  currentText: string;
  isLoading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function RestoreConfirmDialog({
  snapshot,
  currentText,
  isLoading,
  onCancel,
  onConfirm,
}: RestoreConfirmDialogProps) {
  const localize = useLocalize();
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={localize('com_admin_prompts_snapshot_restore_title')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-lg bg-surface-primary text-text-primary shadow-xl">
        <div className="border-b border-border-light p-4 text-base font-semibold">
          {localize('com_admin_prompts_snapshot_restore_title')}
        </div>
        <div className="space-y-3 overflow-auto p-4">
          <div className="text-sm">
            {localize('com_admin_prompts_snapshot_restore_warning')}
          </div>
          <div className="text-xs text-text-secondary">
            <span className="font-mono">
              {new Date(snapshot.snapshotMinute).toLocaleString()}
            </span>
            {' · '}
            {snapshot.sectionKeys.length} sections
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col">
              <div className="mb-1 text-xs font-semibold text-text-secondary">
                {localize('com_admin_prompts_snapshot_before')}
              </div>
              <pre className="max-h-72 overflow-auto rounded border border-border-light bg-surface-primary-alt p-2 font-mono text-xs">
                {currentText}
              </pre>
            </div>
            <div className="flex flex-col">
              <div className="mb-1 text-xs font-semibold text-text-secondary">
                {localize('com_admin_prompts_snapshot_after')}
              </div>
              <pre className="max-h-72 overflow-auto rounded border border-border-light bg-surface-primary-alt p-2 font-mono text-xs">
                {snapshot.sectionKeys.join('\n')}
              </pre>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border-light p-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded bg-surface-primary-alt px-3 py-1 text-sm"
          >
            {localize('com_admin_prompts_cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="rounded bg-emerald-600 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            {localize('com_admin_prompts_restore')}
          </button>
        </div>
      </div>
    </div>
  );
}
