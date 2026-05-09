import { render, screen } from '@testing-library/react';
import DegradationBanner from '../DegradationBanner';

const baseRun = {
  id: 'r', env: 'staging', started_at: '2026-05-09T00:00:00Z', finished_at: null,
  status: 'succeeded' as const,
  total_rows: 11, ab_new_wins: 5, ab_old_wins: 3, ab_ties: 3,
  rubric_pass: 8, rubric_fail: 1, rubric_xfail: 2, rubric_infra: 0,
  pass_rate: 0.889, alert_severity: null, alert_reasons: [],
};

describe('DegradationBanner', () => {
  it('renders nothing when severity is null', () => {
    const { container } = render(<DegradationBanner latestRun={baseRun} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders red banner with reasons listed when severity is red', () => {
    render(<DegradationBanner latestRun={{
      ...baseRun, alert_severity: 'red',
      alert_reasons: [
        { rule: 'pass_rate_cliff', detail: 'pass rate 64% is 18pp below 7-day median 82%' },
        { rule: 'old_wins_majority', detail: 'OLD won 6, NEW won 4' },
      ],
    }} />);
    const banner = screen.getByRole('alert');
    expect(banner).toHaveAttribute('data-severity', 'red');
    expect(banner).toHaveTextContent('Quality regression detected');
    expect(screen.getByText(/pass rate 64%/)).toBeInTheDocument();
    expect(screen.getByText(/OLD won 6/)).toBeInTheDocument();
  });

  it('renders orange banner when severity is orange', () => {
    render(<DegradationBanner latestRun={{
      ...baseRun, alert_severity: 'orange',
      alert_reasons: [{ rule: 'capture_failed', detail: 'NEW failed to answer 2 of 11' }],
    }} />);
    const banner = screen.getByRole('alert');
    expect(banner).toHaveAttribute('data-severity', 'orange');
    expect(banner).toHaveTextContent('Capture issue');
  });

  it('uses aria-live="polite" for accessibility', () => {
    render(<DegradationBanner latestRun={{
      ...baseRun, alert_severity: 'red', alert_reasons: [{ rule: 'r', detail: 'd' }],
    }} />);
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'polite');
  });

  it('renders nothing when latestRun is undefined', () => {
    const { container } = render(<DegradationBanner latestRun={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});
