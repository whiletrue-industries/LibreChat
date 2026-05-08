import type { AdminPromptToolOverrideRow } from 'librechat-data-provider';
import { useToolOverrideVersions } from '~/data-provider/AdminPrompts/queries';
import { useLocalize } from '~/hooks';

interface ToolOverrideVersionsModalProps {
  agentType: string;
  toolName: string;
  isRestoring: boolean;
  onClose: () => void;
  onRestore: (version: AdminPromptToolOverrideRow) => void;
}

export default function ToolOverrideVersionsModal({
  agentType,
  toolName,
  isRestoring,
  onClose,
  onRestore,
}: ToolOverrideVersionsModalProps) {
  const localize = useLocalize();
  const versionsQ = useToolOverrideVersions(agentType, toolName);

  const renderBody = () => {
    if (versionsQ.isLoading) {
      return <div className="p-3 text-sm text-text-secondary">…</div>;
    }
    if (versionsQ.isError || !versionsQ.data) {
      const message = (versionsQ.error as Error | undefined)?.message ?? localize('com_ui_error');
      return <div className="p-3 text-sm text-red-600">{message}</div>;
    }
    const versions = versionsQ.data.versions;
    if (versions.length === 0) {
      return (
        <div className="p-3 text-sm text-text-secondary">
          {localize('com_admin_tool_versions_empty')}
        </div>
      );
    }
    return (
      <ul data-testid="tool-versions-list" className="divide-y divide-border-light">
        {versions.map((v) => (
          <li key={v.id} className="flex flex-col gap-2 p-3 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <div className="font-mono text-xs text-text-secondary">
                {new Date(v.createdAt).toLocaleString()}
                {v.active && (
                  <span className="ml-2 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] text-white">
                    {localize('com_admin_tool_active_label')}
                  </span>
                )}
                {v.isDraft && (
                  <span className="ml-2 rounded bg-amber-600 px-1.5 py-0.5 text-[10px] text-white">
                    {localize('com_admin_tool_draft_label')}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onRestore(v)}
                disabled={isRestoring || v.active}
                className="rounded bg-surface-primary-alt px-2 py-0.5 text-xs disabled:opacity-50"
              >
                {localize('com_admin_prompts_restore')}
              </button>
            </div>
            {v.changeNote && <div className="text-xs text-text-secondary">{v.changeNote}</div>}
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border-light bg-surface-primary-alt p-2 font-mono text-xs">
              {v.description}
            </pre>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={localize('com_admin_tool_versions_title')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-lg bg-surface-primary text-text-primary shadow-xl">
        <div className="flex items-center justify-between border-b border-border-light p-4 text-base font-semibold">
          <span>
            {localize('com_admin_tool_versions_title')}
            <span className="mx-2 text-text-secondary">—</span>
            <span className="font-mono text-sm">{toolName}</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-surface-primary-alt px-2 py-1 text-sm"
          >
            {localize('com_admin_prompts_cancel')}
          </button>
        </div>
        <div className="max-h-[70vh] overflow-auto">{renderBody()}</div>
      </div>
    </div>
  );
}
