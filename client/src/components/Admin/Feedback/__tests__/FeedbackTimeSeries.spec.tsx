import React from 'react';
import { render, screen } from 'test/layout-test-utils';
import FeedbackTimeSeries from '../FeedbackTimeSeries';

describe('FeedbackTimeSeries', () => {
  it('shows empty-state when no points', () => {
    render(<FeedbackTimeSeries points={[]} />);
    expect(screen.getByText(/No feedback recorded yet/i)).toBeInTheDocument();
  });

  it('does not show empty-state when given data', () => {
    const points = [
      { date: '2026-04-17', total: 10, withFeedback: 3, up: 2, down: 1 },
      { date: '2026-04-18', total: 8, withFeedback: 4, up: 3, down: 1 },
    ];
    render(<FeedbackTimeSeries points={points} />);
    expect(screen.queryByText(/No feedback recorded yet/i)).toBeNull();
  });

  it('renders legend labels for both series', () => {
    const points = [{ date: '2026-04-17', total: 10, withFeedback: 3, up: 2, down: 1 }];
    render(<FeedbackTimeSeries points={points} />);
    expect(screen.getByText(/Feedback rate/i)).toBeInTheDocument();
    expect(screen.getByText(/Positive %/i)).toBeInTheDocument();
  });

  it('renders a figure element when given data', () => {
    const points = [
      { date: '2026-04-17', total: 10, withFeedback: 3, up: 2, down: 1 },
      { date: '2026-04-18', total: 8, withFeedback: 4, up: 3, down: 1 },
    ];
    const { container } = render(<FeedbackTimeSeries points={points} />);
    expect(container.querySelector('figure')).not.toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelectorAll('polyline').length).toBe(2);
  });
});
