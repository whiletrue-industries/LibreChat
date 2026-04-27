import React from 'react';
import type { SparklinePoint } from 'librechat-data-provider';

const COLOR_OK = '#1a7f37';
const COLOR_ALERT = '#c0392b';

type Props = {
  points: SparklinePoint[];
  width?: number;
  height?: number;
};

const Sparkline: React.FC<Props> = ({ points, width = 100, height = 24 }) => {
  if (points.length < 2) {
    return <span style={{ opacity: 0.5, fontSize: 11 }}>—</span>;
  }
  const counts = points.map((p) => p.count);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const span = Math.max(max - min, 1);

  const stepX = width / (points.length - 1);
  const stroke = counts.some((c, i) => i > 0 && c < counts[i - 1]) ? COLOR_ALERT : COLOR_OK;

  const polyPoints = points
    .map((p, i) => `${i * stepX},${height - ((p.count - min) / span) * height}`)
    .join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline fill="none" stroke={stroke} strokeWidth={1.5} points={polyPoints} />
    </svg>
  );
};

export default Sparkline;
