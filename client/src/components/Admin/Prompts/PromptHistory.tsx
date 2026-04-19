import { Fragment, useState } from 'react';
import type { AdminPromptVersion } from 'librechat-data-provider';
import {
  useAdminPromptVersions,
  useRestoreAdminPrompt,
} from '~/data-provider/AdminPrompts/queries';
import { useLocalize } from '~/hooks';
import PromptDiff from './PromptDiff';

export interface PromptHistoryProps {
  agentType: string;
  sectionKey: string;
}

function truncate(s: string | undefined, n: number): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export default function PromptHistory({ agentType, sectionKey }: PromptHistoryProps) {
  const localize = useLocalize();
  const versions = useAdminPromptVersions(agentType, sectionKey);
  const restore = useRestoreAdminPrompt();
  const [diffFor, setDiffFor] = useState<string | null>(null);
  const [confirmFor, setConfirmFor] = useState<AdminPromptVersion | null>(null);

  if (versions.isLoading || !versions.data) return null;
  const rows = versions.data.versions;
  const active = rows.find((r) => r.active);

  const handleRestoreConfirm = () => {
    if (!confirmFor) return;
    restore.mutate(
      {
        agentType,
        sectionKey,
        input: { versionId: confirmFor._id },
      },
      { onSettled: () => setConfirmFor(null) },
    );
  };

  return (
    <details className="mt-6 rounded border border-border-medium bg-surface-primary-alt">
      <summary className="cursor-pointer select-none p-3 text-sm font-medium">
        {localize('com_admin_prompts_history')} ({rows.length})
      </summary>
      <div className="p-3">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border-light text-start text-text-secondary">
              <th className="py-2 text-start">{localize('com_admin_prompts_last_edited')}</th>
              <th className="py-2 text-start">{localize('com_admin_prompts_published_by')}</th>
              <th className="py-2 text-start">{localize('com_admin_prompts_change_note')}</th>
              <th className="py-2 text-start"></th>
              <th className="py-2 text-start"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <Fragment key={v._id}>
                <tr className="border-b border-border-light">
                  <td className="py-2">{new Date(v.createdAt).toLocaleString()}</td>
                  <td className="py-2 font-mono text-xs">{v.createdBy ?? '—'}</td>
                  <td className="py-2">{truncate(v.changeNote, 80)}</td>
                  <td className="py-2">
                    {v.active && (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100">
                        active
                      </span>
                    )}
                    {v.isDraft && (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                        {localize('com_admin_prompts_has_draft')}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-end">
                    <button
                      type="button"
                      onClick={() => setDiffFor(diffFor === v._id ? null : v._id)}
                      className="mr-2 text-xs underline"
                    >
                      {localize('com_admin_prompts_diff_with_current')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmFor(v)}
                      disabled={v.active || restore.isLoading}
                      className="rounded bg-surface-primary px-2 py-0.5 text-xs disabled:opacity-50"
                    >
                      {localize('com_admin_prompts_restore')}
                    </button>
                  </td>
                </tr>
                {diffFor === v._id && active && (
                  <tr>
                    <td colSpan={5} className="p-2">
                      <PromptDiff current={active.body} draft={v.body} readOnly height="30vh" />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {confirmFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-96 rounded bg-surface-primary p-4 text-text-primary">
            <p className="mb-4 text-sm">{localize('com_admin_prompts_restore_confirm')}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmFor(null)}
                className="rounded px-3 py-1 text-sm"
              >
                {localize('com_ui_cancel')}
              </button>
              <button
                type="button"
                onClick={handleRestoreConfirm}
                className="rounded bg-amber-600 px-3 py-1 text-sm text-white"
              >
                {localize('com_admin_prompts_restore')}
              </button>
            </div>
          </div>
        </div>
      )}
    </details>
  );
}
