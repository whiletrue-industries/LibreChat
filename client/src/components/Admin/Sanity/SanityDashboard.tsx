import React, { useState } from 'react';
import { dataService, QueryKeys } from 'librechat-data-provider';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminSanityQuery } from '~/data-provider/AdminSanity';
import DegradationBanner from './DegradationBanner';
import RunsTable from './RunsTable';

import type { AdminSanityRunSummary } from 'librechat-data-provider';

function pct(x: number | null | undefined) {
  if (x == null) return '—';
  return `${Math.round(x * 100)}%`;
}

function HeroTile({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'good' | 'warn' | 'bad' | 'neutral';
}) {
  const toneClass = {
    good: 'text-emerald-500',
    warn: 'text-amber-500',
    bad: 'text-red-500',
    neutral: 'text-gray-100',
  }[tone];
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="text-[11px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-gray-400">{hint}</div> : null}
    </div>
  );
}

function passTone(rate: number | null | undefined): 'good' | 'warn' | 'bad' | 'neutral' {
  if (rate == null) return 'neutral';
  if (rate >= 0.9) return 'good';
  if (rate >= 0.7) return 'warn';
  return 'bad';
}

function LaunchButton() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const m = useMutation(() => dataService.launchAdminSanity(), {
    onSuccess: () => {
      setOk(true);
      setError(null);
      // Backend kicks off async; refresh the runs list so the new "running"
      // row appears within a few seconds.
      setTimeout(() => qc.invalidateQueries([QueryKeys.adminSanity]), 4_000);
      setTimeout(() => setOk(false), 6_000);
    },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => m.mutate()}
        disabled={m.isLoading}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {m.isLoading ? 'Launching…' : ok ? '✓ Launched — refreshing…' : 'Run sanity now'}
      </button>
      {error ? <div className="text-xs text-red-500">{error}</div> : null}
    </div>
  );
}

function RunHero({ run }: { run: AdminSanityRunSummary | undefined }) {
  if (!run) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700">
        No runs yet — click <em>Run sanity now</em> to kick off the first one.
      </div>
    );
  }
  const tone = passTone(run.pass_rate);
  const since = new Date(run.started_at);
  const sinceTxt = since.toLocaleString('en-IL', { dateStyle: 'short', timeStyle: 'short' });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <HeroTile
        label="Latest run"
        value={pct(run.pass_rate)}
        hint={`pass-rate · ${sinceTxt}`}
        tone={tone}
      />
      <HeroTile
        label="A/B verdict"
        value={`${run.ab_new_wins ?? 0} / ${run.ab_old_wins ?? 0} / ${run.ab_ties ?? 0}`}
        hint="NEW wins / OLD wins / ties"
        tone={
          (run.ab_old_wins ?? 0) > (run.ab_new_wins ?? 0)
            ? 'bad'
            : (run.ab_new_wins ?? 0) > 0
            ? 'good'
            : 'neutral'
        }
      />
      <HeroTile
        label="Rubric"
        value={`${run.rubric_pass ?? 0} / ${run.rubric_fail ?? 0} / ${run.rubric_xfail ?? 0}`}
        hint={`PASS / FAIL / XFAIL (INFRA: ${run.rubric_infra ?? 0})`}
        tone={(run.rubric_fail ?? 0) === 0 ? 'good' : (run.rubric_fail ?? 0) <= 2 ? 'warn' : 'bad'}
      />
      <HeroTile
        label="Alert"
        value={
          run.alert_severity === 'red'
            ? '🚨 RED'
            : run.alert_severity === 'orange'
            ? '⚠ orange'
            : '✓ healthy'
        }
        hint={(run.alert_reasons ?? []).map((a) => a.detail).join(' · ') || 'no rules tripped'}
        tone={
          run.alert_severity === 'red'
            ? 'bad'
            : run.alert_severity === 'orange'
            ? 'warn'
            : 'good'
        }
      />
    </div>
  );
}

export default function SanityDashboard() {
  const { data, isLoading, isError } = useAdminSanityQuery();

  if (isLoading) return <div className="p-6 text-sm">Loading sanity runs…</div>;
  if (isError) return <div className="p-6 text-sm text-red-500">Failed to load sanity runs</div>;

  const runs = data?.runs ?? [];
  const latest = runs.find((r) => r.status === 'succeeded') ?? runs[0];

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sanity DoD</h1>
          <div className="mt-1 text-sm text-gray-500">
            Side-by-side gold-set comparison · old (legacy) vs new (this stack)
          </div>
        </div>
        <LaunchButton />
      </div>

      <DegradationBanner latestRun={latest} />

      <div className="mb-6 mt-4">
        <RunHero run={latest} />
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
            History
          </h2>
          <div className="text-xs text-gray-400">
            click a row to open the deep-dive HTML report
          </div>
        </div>
        <RunsTable runs={runs} />
      </div>
    </div>
  );
}
