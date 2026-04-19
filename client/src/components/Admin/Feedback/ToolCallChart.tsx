import { useLocalize } from '~/hooks';
import type { AdminFeedbackToolRow } from 'librechat-data-provider';

type Props = { rows: AdminFeedbackToolRow[] };

export default function ToolCallChart({ rows }: Props) {
  const localize = useLocalize();
  if (rows.length === 0) {
    return null;
  }
  const max = Math.max(1, ...rows.map((r) => r.thumbsDown));
  return (
    <div className="mb-6 rounded-lg border border-border-medium bg-surface-primary-alt p-4 text-text-primary">
      <h3 className="mb-3 text-sm font-semibold">{localize('com_admin_feedback_tool_header')}</h3>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.toolName} className="flex items-center gap-3">
            <span className="w-48 truncate text-xs text-text-primary" title={row.toolName}>
              {row.toolName}
            </span>
            <span className="flex-1">
              <span
                className="block h-4 rounded-sm bg-red-500 dark:bg-red-400"
                style={{ width: `${(row.thumbsDown / max) * 100}%` }}
                aria-hidden="true"
              />
            </span>
            <span className="ms-auto w-10 text-end text-xs font-medium text-text-primary">{row.thumbsDown}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
