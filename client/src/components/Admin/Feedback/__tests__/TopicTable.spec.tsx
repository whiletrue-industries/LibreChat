import { render, screen, fireEvent } from 'test/layout-test-utils';
import TopicTable from '../TopicTable';

describe('TopicTable', () => {
  it('renders rows sorted by total descending, clicks trigger onSelect', () => {
    const onSelect = jest.fn();
    render(
      <TopicTable
        onSelect={onSelect}
        rows={[
          {
            topic: 'ethics',
            total: 40,
            withFeedback: 10,
            positivePct: 50,
            lastThumbsDownAt: null,
          },
          {
            topic: 'budget_ministries',
            total: 100,
            withFeedback: 20,
            positivePct: 80,
            lastThumbsDownAt: null,
          },
        ]}
      />,
    );
    const rows = screen.getAllByRole('row');
    // rows[0] is thead; rows[1] is first body row — highest total first
    expect(rows[1]).toHaveTextContent('budget_ministries');
    fireEvent.click(rows[1]);
    expect(onSelect).toHaveBeenCalledWith('budget_ministries');
  });

  it('renders empty state when no rows', () => {
    const onSelect = jest.fn();
    render(<TopicTable rows={[]} onSelect={onSelect} />);
    expect(screen.getByText(/No feedback recorded yet/i)).toBeInTheDocument();
  });

  it('formats null positivePct as em-dash', () => {
    const onSelect = jest.fn();
    render(
      <TopicTable
        rows={[
          {
            topic: 'unknown',
            total: 5,
            withFeedback: 0,
            positivePct: null,
            lastThumbsDownAt: null,
          },
        ]}
        onSelect={onSelect}
      />,
    );
    // two em-dashes: one for positivePct, one for lastThumbsDownAt
    expect(screen.getAllByText('—').length).toBe(2);
  });
});
