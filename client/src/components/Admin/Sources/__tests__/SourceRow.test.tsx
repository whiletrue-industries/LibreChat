import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SourceRow from '../SourceRow';

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  dataService: {
    getAdminSource: jest.fn(() => Promise.resolve({
      context_summary: { context: 'legal_text', doc_count: 488, last_synced_at: 'now', sparkline: [] },
      sources: [],
    })),
  },
}));

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <table><tbody>{ui}</tbody></table>
    </QueryClientProvider>,
  );

const baseCtx = {
  context: 'legal_text',
  doc_count: 985,
  prev_count: 985,
  sparkline: [{ at: 'a', count: 985 }, { at: 'b', count: 985 }],
  last_synced_at: '2026-04-27T12:00:00Z',
  document_count: 488,
  drift_alert: false,
};

describe('SourceRow', () => {
  it('renders the context name, document count, and chunk count', () => {
    wrap(<SourceRow ctx={baseCtx} />);
    expect(screen.getByText('legal_text')).toBeInTheDocument();
    expect(screen.getByText('488')).toBeInTheDocument();
    expect(screen.getByText('985')).toBeInTheDocument();
  });

  it('shows a drift-alert prefix and red styling when drift_alert is true', () => {
    wrap(<SourceRow ctx={{ ...baseCtx, drift_alert: true, prev_count: 500 }} />);
    expect(screen.getByText(/⚠/)).toBeInTheDocument();
  });

  it('does not fetch breakdown until expanded', () => {
    const ds = require('librechat-data-provider').dataService;
    wrap(<SourceRow ctx={baseCtx} />);
    expect(ds.getAdminSource).not.toHaveBeenCalled();
  });

  it('toggles expanded state on click and fetches breakdown', async () => {
    const ds = require('librechat-data-provider').dataService;
    wrap(<SourceRow ctx={baseCtx} />);
    fireEvent.click(screen.getByText('legal_text'));
    await screen.findByText(/loading|no snapshots/);
    expect(ds.getAdminSource).toHaveBeenCalledWith('legal_text');
  });
});
