import React from 'react';
import type { AdminSanityRunSummary } from 'librechat-data-provider';

type Props = { latestRun?: AdminSanityRunSummary };

export default function DegradationBanner({ latestRun }: Props) {
  if (!latestRun || !latestRun.alert_severity) return null;
  const sev = latestRun.alert_severity;
  const heading =
    sev === 'red' ? '⚠ Quality regression detected on this run' : 'Capture issue on this run';
  const cls =
    sev === 'red'
      ? 'bg-red-100 border-red-500 text-red-900 dark:bg-red-900/30 dark:text-red-200'
      : 'bg-orange-100 border-orange-500 text-orange-900 dark:bg-orange-900/30 dark:text-orange-200';
  return (
    <div
      role="alert"
      aria-live="polite"
      data-severity={sev}
      className={`mb-4 rounded-md border-l-4 p-4 ${cls}`}
    >
      <div className="font-semibold text-base">{heading}</div>
      <ul className="mt-2 list-disc pl-5 text-sm">
        {latestRun.alert_reasons.map((r, i) => (
          <li key={i}>{r.detail}</li>
        ))}
      </ul>
      <div className="mt-2 text-xs opacity-70">
        Click the latest row below to see the full report.
      </div>
    </div>
  );
}
