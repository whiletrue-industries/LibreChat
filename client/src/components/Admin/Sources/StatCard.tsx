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
      style={{
        padding: 14,
        borderRadius: 8,
        background: isWarn ? 'rgba(192,57,43,0.08)' : 'rgba(127,127,127,0.08)',
      }}
    >
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.6px', opacity: 0.7 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          marginTop: 4,
          fontVariantNumeric: 'tabular-nums',
          color: isWarn ? '#c0392b' : undefined,
        }}
      >
        {value}
      </div>
      {sub ? <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
};

export default StatCard;
