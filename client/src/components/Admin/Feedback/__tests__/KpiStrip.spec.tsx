import React from 'react';
import { render, screen } from 'test/layout-test-utils';
import KpiStrip from '../KpiStrip';

describe('KpiStrip', () => {
  it('renders formatted values', () => {
    render(
      <KpiStrip
        kpis={{
          total: 120,
          withFeedback: 30,
          feedbackRate: 25,
          thumbsUp: 22,
          thumbsDown: 8,
          positivePct: 73.3,
        }}
      />,
    );
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText('73.3%')).toBeInTheDocument();
  });

  it('renders em dash for null positivePct (no feedback)', () => {
    render(
      <KpiStrip
        kpis={{
          total: 0,
          withFeedback: 0,
          feedbackRate: null,
          thumbsUp: 0,
          thumbsDown: 0,
          positivePct: null,
        }}
      />,
    );
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });
});
