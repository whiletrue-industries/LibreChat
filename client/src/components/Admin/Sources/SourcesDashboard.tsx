import React from 'react';
import { useAdminSourcesQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';
import SourceRow from './SourceRow';
import StatCard from './StatCard';

const relativeAge = (iso: string | null): string => {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
};

const SourcesDashboard: React.FC = () => {
  const localize = useLocalize();
  const { data, isLoading, error } = useAdminSourcesQuery();

  if (isLoading) {
    return (
      <main className="mx-auto w-full max-w-7xl bg-surface-primary p-6 text-text-primary" dir="ltr">
        {localize('com_admin_sources_title')}…
      </main>
    );
  }
  if (error) {
    return (
      <main className="mx-auto max-w-6xl bg-surface-primary p-6 text-red-600 dark:text-red-400">
        error loading sources
      </main>
    );
  }
  const contexts = data?.contexts ?? [];

  if (contexts.length === 0) {
    return (
      <main className="mx-auto w-full max-w-7xl bg-surface-primary p-6 text-text-primary" dir="ltr">
        <h1 className="mb-4 text-xl font-semibold">
          {localize('com_admin_sources_title')}
        </h1>
        <p className="text-text-secondary">
          {localize('com_admin_sources_no_history')}
        </p>
      </main>
    );
  }

  const totalDocs = contexts.reduce((acc, c) => acc + c.doc_count, 0);
  const lastSync =
    contexts
      .map((c) => c.last_synced_at)
      .sort()
      .pop() ?? null;
  const driftCount = contexts.filter((c) => c.drift_alert).length;
  const sortedByAge = contexts
    .slice()
    .sort(
      (a, b) =>
        new Date(a.last_synced_at).getTime() - new Date(b.last_synced_at).getTime(),
    );
  const oldestTs = sortedByAge[0]?.last_synced_at;
  const newestTs = sortedByAge[sortedByAge.length - 1]?.last_synced_at;
  const hasStalestGap = oldestTs !== newestTs;
  const stalest = hasStalestGap ? sortedByAge[0] : null;

  return (
    <main className="mx-auto w-full max-w-7xl bg-surface-primary p-6 text-text-primary" dir="ltr">
      <h1 className="mb-4 text-xl font-semibold">
        {localize('com_admin_sources_title')}
      </h1>
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={localize('com_admin_sources_total_docs')}
          value={totalDocs.toLocaleString()}
          sub={`${contexts.length} contexts`}
        />
        <StatCard
          label={localize('com_admin_sources_last_sync')}
          value={relativeAge(lastSync)}
          sub={lastSync?.slice(0, 16) || ''}
        />
        <StatCard
          label={localize('com_admin_sources_drift_alerts')}
          value={driftCount}
          variant={driftCount > 0 ? 'warn' : 'default'}
        />
        <StatCard
          label={localize('com_admin_sources_stalest')}
          value={relativeAge(stalest?.last_synced_at ?? null)}
          sub={stalest?.context || ''}
        />
      </div>
      <div className="overflow-hidden rounded-lg border border-border-medium">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border-medium bg-surface-primary-alt text-xs uppercase tracking-wider text-text-secondary">
              <th className="px-4 py-2 text-left">
                {localize('com_admin_sources_col_context')}
              </th>
              <th className="px-4 py-2 text-right">
                {localize('com_admin_sources_col_docs')}
              </th>
              <th className="px-4 py-2 text-left">
                {localize('com_admin_sources_col_trend')}
              </th>
              <th className="px-4 py-2 text-left">
                {localize('com_admin_sources_col_last_sync')}
              </th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-light">
            {contexts.map((c) => (
              <SourceRow key={c.context} ctx={c} />
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
};

export default SourcesDashboard;
