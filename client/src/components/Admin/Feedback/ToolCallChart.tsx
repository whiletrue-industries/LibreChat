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
    <div className="mb-6 rounded-lg border border-border-medium p-4">
      <h3 className="mb-3 text-sm font-medium">{localize('com_admin_feedback_tool_header')}</h3>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.toolName} className="flex items-center gap-3">
            <span className="w-48 truncate text-xs text-text-secondary" title={row.toolName}>
              {row.toolName}
            </span>
            <span
              className="h-4 rounded-sm bg-red-500/60"
              style={{ width: `${(row.thumbsDown / max) * 100}%` }}
              aria-hidden="true"
            />
            <span className="ms-auto w-10 text-end text-xs">{row.thumbsDown}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
