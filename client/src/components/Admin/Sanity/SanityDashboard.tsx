import React from 'react';
import { useAdminSanityQuery } from '~/data-provider/AdminSanity';
import DegradationBanner from './DegradationBanner';
import RunsTable from './RunsTable';

export default function SanityDashboard() {
  const { data, isLoading, isError } = useAdminSanityQuery();

  if (isLoading) return <div className="p-6 text-sm">Loading sanity runs…</div>;
  if (isError) return <div className="p-6 text-sm text-red-500">Failed to load sanity runs</div>;

  const runs = data?.runs ?? [];
  const latest = runs.find((r) => r.status === 'succeeded') ?? runs[0];

  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold">Sanity DoD — old vs new</h1>
      <DegradationBanner latestRun={latest} />
      <RunsTable runs={runs} />
    </div>
  );
}
