import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RunsTable from '../RunsTable';

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  dataService: {
    getAdminSanityHtml: jest.fn(),
  },
}));
const { dataService } = require('librechat-data-provider');

const make = (over: Partial<any> = {}) => ({
  id: 'r1', env: 'staging', started_at: '2026-05-09T00:00:00Z',
  finished_at: '2026-05-09T00:25:00Z', status: 'succeeded',
  total_rows: 11, ab_new_wins: 5, ab_old_wins: 3, ab_ties: 3,
  rubric_pass: 8, rubric_fail: 1, rubric_xfail: 2, rubric_infra: 0,
  pass_rate: 0.889, alert_severity: null, alert_reasons: [],
  ...over,
});

beforeAll(() => {
  window.open = jest.fn();
  // Polyfill for jsdom
  (global as any).URL.createObjectURL = jest.fn(() => 'blob:test-url');
  (global as any).URL.revokeObjectURL = jest.fn();
});

beforeEach(() => {
  dataService.getAdminSanityHtml.mockReset();
  (window.open as jest.Mock).mockReset();
});

describe('RunsTable', () => {
  it('renders empty state', () => {
    render(<RunsTable runs={[]} />);
    expect(screen.getByText(/no runs yet/i)).toBeInTheDocument();
  });

  it('renders rows in given order', () => {
    render(<RunsTable runs={[make({ id: 'a' }), make({ id: 'b' })]} />);
    const rows = screen.getAllByRole('row').slice(1); // skip header
    expect(rows).toHaveLength(2);
  });

  it('shows pass-rate as percentage', () => {
    render(<RunsTable runs={[make({ pass_rate: 0.667 })]} />);
    expect(screen.getByText('67%')).toBeInTheDocument();
  });

  it('shows red severity dot when alert_severity is red', () => {
    render(<RunsTable runs={[make({ id: 'r1', alert_severity: 'red' })]} />);
    const dot = screen.getByTestId('severity-dot-r1');
    expect(dot).toHaveAttribute('data-severity', 'red');
  });

  it('clicking row fetches HTML with auth and opens it as a Blob URL', async () => {
    dataService.getAdminSanityHtml.mockResolvedValueOnce('<!doctype html><p>row html</p>');
    render(<RunsTable runs={[make({ id: 'rid-7' })]} />);
    fireEvent.click(screen.getByRole('row', { name: /rid-7/i }));
    await waitFor(() => expect(dataService.getAdminSanityHtml).toHaveBeenCalled());
    expect(dataService.getAdminSanityHtml).toHaveBeenCalledWith('rid-7');
    expect(window.open).toHaveBeenCalledWith('blob:test-url', '_blank');
  });

  it('running row shows spinner status', () => {
    render(<RunsTable runs={[make({ status: 'running', finished_at: null, pass_rate: null })]} />);
    expect(screen.getByText(/running/i)).toBeInTheDocument();
  });

  it('failed row shows red status', () => {
    render(<RunsTable runs={[make({ status: 'failed' })]} />);
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
  });
});
