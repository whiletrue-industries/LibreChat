import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SanityDashboard from '../SanityDashboard';

jest.mock('~/data-provider/AdminSanity', () => ({
  useAdminSanityQuery: jest.fn(),
}));
const { useAdminSanityQuery } = require('~/data-provider/AdminSanity');

function withQuery(node: React.ReactNode) {
  const q = new QueryClient();
  return <QueryClientProvider client={q}>{node}</QueryClientProvider>;
}

beforeEach(() => useAdminSanityQuery.mockReset());

it('shows loading state', () => {
  useAdminSanityQuery.mockReturnValue({ isLoading: true });
  render(withQuery(<SanityDashboard />));
  expect(screen.getByText(/loading/i)).toBeInTheDocument();
});

it('shows error state', () => {
  useAdminSanityQuery.mockReturnValue({ isError: true, error: new Error('boom') });
  render(withQuery(<SanityDashboard />));
  expect(screen.getByText(/failed/i)).toBeInTheDocument();
});

it('shows banner + table on success', () => {
  useAdminSanityQuery.mockReturnValue({
    isLoading: false, isError: false,
    data: { runs: [{
      id: 'r1', env: 'staging', started_at: '2026-05-09T00:00:00Z', finished_at: null,
      status: 'succeeded',
      total_rows: 11, ab_new_wins: 4, ab_old_wins: 6, ab_ties: 1,
      rubric_pass: 7, rubric_fail: 2, rubric_xfail: 2, rubric_infra: 0,
      pass_rate: 0.778, alert_severity: 'red',
      alert_reasons: [{ rule: 'old_wins_majority', detail: 'OLD won 6, NEW won 4' }],
    }] },
  });
  render(withQuery(<SanityDashboard />));
  expect(screen.getByRole('alert')).toHaveAttribute('data-severity', 'red');
  expect(screen.getByText(/OLD won 6/)).toBeInTheDocument();
});

it('shows no banner when latest run has no alert', () => {
  useAdminSanityQuery.mockReturnValue({
    isLoading: false, isError: false,
    data: { runs: [{
      id: 'r1', env: 'staging', started_at: '2026-05-09T00:00:00Z', finished_at: null,
      status: 'succeeded',
      total_rows: 11, ab_new_wins: 5, ab_old_wins: 3, ab_ties: 3,
      rubric_pass: 8, rubric_fail: 1, rubric_xfail: 2, rubric_infra: 0,
      pass_rate: 0.889, alert_severity: null, alert_reasons: [],
    }] },
  });
  render(withQuery(<SanityDashboard />));
  expect(screen.queryByRole('alert')).toBeNull();
});
