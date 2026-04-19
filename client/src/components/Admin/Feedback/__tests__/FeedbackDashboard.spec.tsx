import React from 'react';
import { render, screen } from 'test/layout-test-utils';
import { FeedbackDashboard } from '../';

jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ user: { role: 'ADMIN' } }),
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/data-provider/AdminFeedback/queries', () => ({
  useAdminFeedbackOverview: () => ({
    isLoading: false,
    isError: false,
    data: {
      range: { since: null, until: null },
      kpis: {
        total: 10,
        withFeedback: 5,
        feedbackRate: 50,
        thumbsUp: 4,
        thumbsDown: 1,
        positivePct: 80,
      },
      timeSeries: [],
      byTopic: [
        {
          topic: 'budget_ministries',
          total: 5,
          withFeedback: 2,
          positivePct: 100,
          lastThumbsDownAt: null,
        },
      ],
      byTool: [],
      pendingTopicsCount: 0,
    },
    refetch: jest.fn(),
  }),
  useAdminFeedbackPending: () => ({ data: { pending: [] } }),
  useAdminFeedbackMessages: () => ({ data: undefined, isFetching: false }),
  useApproveAdminFeedbackPending: () => ({ mutate: jest.fn() }),
  useRejectAdminFeedbackPending: () => ({ mutate: jest.fn() }),
}));

describe('FeedbackDashboard', () => {
  it('renders the headline topic and KPI values', () => {
    render(<FeedbackDashboard />);
    expect(screen.getByText('budget_ministries')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
  });

  it('renders the page heading localization key', () => {
    render(<FeedbackDashboard />);
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByText('com_admin_feedback_title')).toBeInTheDocument();
  });

  it('renders the filter bar', () => {
    render(<FeedbackDashboard />);
    expect(screen.getByRole('toolbar')).toBeInTheDocument();
  });
});
