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
    return <div style={{ padding: 24 }}>{localize('com_admin_sources_title')}…</div>;
  }
  if (error) {
    return <div style={{ padding: 24, color: '#c0392b' }}>error loading sources</div>;
  }
  const contexts = data?.contexts ?? [];

  if (contexts.length === 0) {
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
          {localize('com_admin_sources_title')}
        </h2>
        <p style={{ opacity: 0.7 }}>{localize('com_admin_sources_no_history')}</p>
      </div>
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
      (a, b) => new Date(a.last_synced_at).getTime() - new Date(b.last_synced_at).getTime(),
    );
  const oldestTs = sortedByAge[0]?.last_synced_at;
  const newestTs = sortedByAge[sortedByAge.length - 1]?.last_synced_at;
  const hasStalestGap = oldestTs !== newestTs;
  const stalest = hasStalestGap ? sortedByAge[0] : null;

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
        {localize('com_admin_sources_title')}
      </h2>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          marginBottom: 18,
        }}
      >
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
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr
            style={{
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.6px',
              opacity: 0.7,
            }}
          >
            <th style={{ textAlign: 'left', padding: '8px 14px' }}>Context</th>
            <th style={{ textAlign: 'right', padding: '8px 14px' }}>Docs</th>
            <th style={{ textAlign: 'left', padding: '8px 14px' }}>Trend</th>
            <th style={{ textAlign: 'left', padding: '8px 14px' }}>Last sync</th>
            <th style={{ width: 30 }}></th>
          </tr>
        </thead>
        <tbody>
          {contexts.map((c) => (
            <SourceRow key={c.context} ctx={c} />
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default SourcesDashboard;
