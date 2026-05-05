import React from 'react';
import {
  useAdminRefreshStatusQuery,
  useAdminRefreshTriggerMutation,
} from '~/data-provider';
import type { AdminRefreshStatusResponse } from 'librechat-data-provider';

const fmtDuration = (start: string | null, end: string | null): string => {
  if (!start) return '—';
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const sec = Math.max(0, Math.round((endMs - startMs) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
};

const statusBadge = (status: AdminRefreshStatusResponse['status']) => {
  const map: Record<typeof status, { label: string; cls: string }> = {
    idle: { label: 'idle', cls: 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200' },
    running: { label: 'running', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' },
    done: { label: 'done', cls: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
    failed: { label: 'failed', cls: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
  };
  const m = map[status] ?? map.idle;
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${m.cls}`}>
      {m.label}
    </span>
  );
};

const RefreshPanel: React.FC = () => {
  const { data, isLoading } = useAdminRefreshStatusQuery();
  const trigger = useAdminRefreshTriggerMutation();

  const status = data?.status ?? 'idle';
  const isRunning = status === 'running';
  const total = data?.total_contexts ?? 0;
  const done = data?.completed_count ?? 0;
  const ok = data?.ok_count ?? 0;
  const failed = data?.failed_count ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <section
      aria-label="Refresh"
      className="mb-5 rounded-lg border border-border-medium bg-surface-primary-alt p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold">Refresh</h2>
          {!isLoading && statusBadge(status)}
        </div>
        <button
          type="button"
          aria-label="Trigger refresh"
          onClick={() => trigger.mutate()}
          disabled={isRunning || trigger.isLoading}
          className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          {isRunning ? 'Running…' : trigger.isLoading ? 'Triggering…' : 'Refresh now'}
        </button>
      </div>

      {trigger.isError && (
        <p className="mb-2 text-sm text-red-600 dark:text-red-400">
          Failed to trigger: {trigger.error?.message || 'unknown error'}
        </p>
      )}

      {data && status !== 'idle' && (
        <>
          <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-text-secondary">
            <span>
              progress: <strong className="text-text-primary">{done}/{total}</strong>
              {total > 0 ? ` (${pct}%)` : ''}
            </span>
            <span>ok: <strong className="text-text-primary">{ok}</strong></span>
            <span>
              failed: <strong className={failed > 0 ? 'text-red-600 dark:text-red-400' : 'text-text-primary'}>
                {failed}
              </strong>
            </span>
            <span>
              elapsed: <strong className="text-text-primary">
                {fmtDuration(data.started_at, data.finished_at)}
              </strong>
            </span>
          </div>

          {total > 0 && (
            <div className="mb-3 h-2 w-full overflow-hidden rounded bg-gray-200 dark:bg-gray-700">
              <div
                className="h-full bg-green-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}

          {data.current && (
            <p className="mb-2 text-sm">
              syncing{' '}
              <code className="rounded bg-surface-primary px-1.5 py-0.5">
                {data.current.bot}/{data.current.context}
              </code>{' '}
              <span className="text-text-secondary">
                ({fmtDuration(data.current.started_at, null)})
              </span>
            </p>
          )}

          {data.completed.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-text-secondary">
                {data.completed.length} completed contexts
              </summary>
              <ul className="mt-2 space-y-1 text-sm">
                {data.completed.map((c, i) => (
                  <li key={`${c.context}-${i}`} className="flex items-baseline gap-2">
                    <span
                      className={
                        c.status === 'ok'
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-red-600 dark:text-red-400'
                      }
                    >
                      {c.status === 'ok' ? '✓' : '✗'}
                    </span>
                    <code className="text-text-primary">{c.context}</code>
                    <span className="text-text-secondary">
                      {fmtDuration(c.started_at, c.finished_at)}
                    </span>
                    {c.error_message && (
                      <span className="text-red-600 dark:text-red-400">
                        — {c.error_type}: {c.error_message.slice(0, 120)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {data.last_error && status === 'failed' && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">
              run-level error: {data.last_error}
            </p>
          )}
        </>
      )}
    </section>
  );
};

export default RefreshPanel;
