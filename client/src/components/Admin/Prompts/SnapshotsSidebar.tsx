import { useState } from 'react';
import type { AdminPromptSnapshot } from 'librechat-data-provider';
import {
  useJoinedPrompt,
  useRestoreSnapshot,
  useSnapshots,
} from '~/data-provider/AdminPrompts/queries';
import { useLocalize } from '~/hooks';
import RestoreConfirmDialog from './RestoreConfirmDialog';

interface SnapshotsSidebarProps {
  agentType: string;
}

export default function SnapshotsSidebar({ agentType }: SnapshotsSidebarProps) {
  const localize = useLocalize();
  const snapshotsQ = useSnapshots(agentType);
  const joinedQ = useJoinedPrompt(agentType);
  const restore = useRestoreSnapshot(agentType);
  const [pending, setPending] = useState<AdminPromptSnapshot | null>(null);

  const renderBody = () => {
    if (snapshotsQ.isLoading) {
      return <div className="p-3 text-sm text-text-secondary">…</div>;
    }
    if (snapshotsQ.isError || !snapshotsQ.data) {
      const message =
        (snapshotsQ.error as Error | undefined)?.message ?? 'Error';
      return <div className="p-3 text-sm text-red-600">{message}</div>;
    }
    const rows = snapshotsQ.data.snapshots;
    if (rows.length === 0) {
      return (
        <div className="p-3 text-sm text-text-secondary">
          {localize('com_admin_prompts_snapshots_empty')}
        </div>
      );
    }
    return (
      <ul className="divide-y divide-border-light">
        {rows.map((row) => (
          <li key={row.snapshotMinute} className="flex flex-col gap-1 p-3 text-sm">
            <div className="font-mono text-xs">
              {new Date(row.snapshotMinute).toLocaleString()}
            </div>
            {row.publishedBy && (
              <div className="text-xs text-text-secondary">
                {localize('com_admin_prompts_snapshot_published_by')}{' '}
                <span className="font-mono">{row.publishedBy}</span>
              </div>
            )}
            <div>
              <button
                type="button"
                onClick={() => setPending(row)}
                className="rounded bg-surface-primary-alt px-2 py-0.5 text-xs"
              >
                {localize('com_admin_prompts_restore')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <aside className="rounded border border-border-medium bg-surface-primary-alt">
      <div className="border-b border-border-light p-3 text-sm font-semibold">
        {localize('com_admin_prompts_snapshots')}
      </div>
      {renderBody()}
      {pending && (
        <RestoreConfirmDialog
          agentType={agentType}
          snapshot={pending}
          currentText={joinedQ.data?.joinedText ?? ''}
          isLoading={restore.isLoading}
          onCancel={() => setPending(null)}
          onConfirm={() =>
            restore.mutate(
              { minute: pending.snapshotMinute },
              { onSettled: () => setPending(null) },
            )
          }
        />
      )}
    </aside>
  );
}
