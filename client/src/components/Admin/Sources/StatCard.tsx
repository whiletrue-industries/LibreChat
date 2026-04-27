import React from 'react';

type Props = {
  label: string;
  value: string | number;
  sub?: string;
  variant?: 'default' | 'warn';
};

const StatCard: React.FC<Props> = ({ label, value, sub, variant = 'default' }) => {
  const isWarn = variant === 'warn';
  return (
    <div
      className={
        isWarn
          ? 'rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/30'
          : 'rounded-lg border border-border-medium bg-surface-primary-alt p-4'
      }
    >
      <div className="text-xs uppercase tracking-wider text-text-secondary">{label}</div>
      <div
        className={
          'mt-1 text-2xl font-bold tabular-nums ' +
          (isWarn ? 'text-red-600 dark:text-red-400' : 'text-text-primary')
        }
      >
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-xs text-text-secondary">{sub}</div> : null}
    </div>
  );
};

export default StatCard;
