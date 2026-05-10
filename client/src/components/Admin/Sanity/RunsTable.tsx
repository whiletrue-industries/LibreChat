import React from 'react';
import { dataService } from 'librechat-data-provider';
import type { AdminSanityRunSummary } from 'librechat-data-provider';

type Props = { runs: AdminSanityRunSummary[] };

async function openRunHtml(id: string) {
  // The HTML route requires JWT auth. window.open() can't carry the
  // Bearer token (data-provider sets it in axios.defaults.headers.common,
  // not in cookies), so fetch with auth via the data-provider then hand
  // the response to a Blob URL the browser can navigate to.
  const html = await dataService.getAdminSanityHtml(id);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function fmtDate(s: string) {
  return new Date(s).toLocaleString('en-IL', { dateStyle: 'short', timeStyle: 'short' });
}

function fmtPct(x: number | null) {
  return x == null ? '—' : `${Math.round(x * 100)}%`;
}

function SeverityDot({
  sev,
  rowId,
}: {
  sev: AdminSanityRunSummary['alert_severity'];
  rowId: string;
}) {
  const color =
    sev === 'red' ? 'bg-red-500' : sev === 'orange' ? 'bg-orange-500' : 'bg-green-500';
  return (
    <span
      data-testid={`severity-dot-${rowId}`}
      data-severity={sev ?? 'none'}
      className={`inline-block h-2.5 w-2.5 rounded-full ${color}`}
    />
  );
}

export default function RunsTable({ runs }: Props) {
  if (runs.length === 0) {
    return (
      <div className="rounded-md border p-6 text-center text-sm opacity-60">No runs yet</div>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left">
          <th className="py-2 px-3">When</th>
          <th className="py-2 px-3">Status</th>
          <th className="py-2 px-3">A/B (NEW/OLD/TIE)</th>
          <th className="py-2 px-3">Rubric (P/F/X/I)</th>
          <th className="py-2 px-3 text-right">Pass-rate</th>
          <th className="py-2 px-3 text-center">Alert</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr
            key={r.id}
            role="row"
            aria-label={r.id}
            onClick={() => {
              void openRunHtml(r.id);
            }}
            className="cursor-pointer border-b hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <td className="py-2 px-3 font-mono text-xs">{fmtDate(r.started_at)}</td>
            <td className="py-2 px-3">{r.status}</td>
            <td className="py-2 px-3 tabular-nums">
              {r.ab_new_wins ?? '—'} / {r.ab_old_wins ?? '—'} / {r.ab_ties ?? '—'}
            </td>
            <td className="py-2 px-3 tabular-nums">
              {r.rubric_pass ?? '—'} / {r.rubric_fail ?? '—'} / {r.rubric_xfail ?? '—'} /{' '}
              {r.rubric_infra ?? '—'}
            </td>
            <td className="py-2 px-3 text-right tabular-nums">{fmtPct(r.pass_rate)}</td>
            <td className="py-2 px-3 text-center">
              <SeverityDot sev={r.alert_severity} rowId={r.id} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
