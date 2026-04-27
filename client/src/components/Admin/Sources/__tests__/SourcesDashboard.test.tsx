import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SourcesDashboard from '../SourcesDashboard';

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  dataService: {
    getAdminSources: jest.fn(),
    getAdminSource: jest.fn(),
  },
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) =>
    ({
      com_admin_sources_title: 'Data sources',
      com_admin_sources_total_docs: 'Total documents',
      com_admin_sources_last_sync: 'Last sync',
      com_admin_sources_drift_alerts: 'Drift alerts',
      com_admin_sources_stalest: 'Stalest context',
      com_admin_sources_no_history: 'Awaiting first snapshot',
    }[key] ?? key),
}));

const wrap = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe('SourcesDashboard', () => {
  it('renders summary cards and table rows', async () => {
    require('librechat-data-provider').dataService.getAdminSources.mockResolvedValue({
      contexts: [
        {
          context: 'legal_text',
          doc_count: 488,
          prev_count: 488,
          sparkline: [
            { at: 'a', count: 488 },
            { at: 'b', count: 488 },
          ],
          last_synced_at: new Date().toISOString(),
          source_count: 8,
          drift_alert: false,
        },
        {
          context: 'ethics_decisions',
          doc_count: 273,
          prev_count: 285,
          sparkline: [
            { at: 'a', count: 285 },
            { at: 'b', count: 273 },
          ],
          last_synced_at: new Date().toISOString(),
          source_count: 1,
          drift_alert: true,
        },
      ],
    });
    wrap(<SourcesDashboard />);
    await waitFor(() => expect(screen.getByText('legal_text')).toBeInTheDocument());
    expect(screen.getByText('ethics_decisions')).toBeInTheDocument();
    expect(screen.getByText(/Drift alerts/i).parentElement).toHaveTextContent(/1/);
  });

  it('shows the empty / awaiting-snapshot state when contexts is empty', async () => {
    require('librechat-data-provider').dataService.getAdminSources.mockResolvedValue({
      contexts: [],
    });
    wrap(<SourcesDashboard />);
    await waitFor(() =>
      expect(screen.getByText(/Awaiting first snapshot/i)).toBeInTheDocument(),
    );
  });
});
