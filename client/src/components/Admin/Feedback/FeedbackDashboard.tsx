import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SystemRoles } from 'librechat-data-provider';
import type { AdminFeedbackOverviewFilter } from 'librechat-data-provider';
import {
  useAdminFeedbackMessages,
  useAdminFeedbackOverview,
  useAdminFeedbackPending,
  useApproveAdminFeedbackPending,
  useRejectAdminFeedbackPending,
} from '~/data-provider/AdminFeedback/queries';
import { useAuthContext, useLocalize } from '~/hooks';
import FeedbackDrillDown from './FeedbackDrillDown';
import PendingTopicsQueue from './PendingTopicsQueue';
import FeedbackTimeSeries from './FeedbackTimeSeries';
import ToolCallChart from './ToolCallChart';
import TopicTable from './TopicTable';
import FilterBar from './FilterBar';
import KpiStrip from './KpiStrip';

const INITIAL_DAYS = 30;

export default function FeedbackDashboard() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { user } = useAuthContext();

  const initialFilter = useMemo<AdminFeedbackOverviewFilter>(() => {
    const until = new Date();
    const since = new Date(until);
    since.setDate(until.getDate() - INITIAL_DAYS);
    return { since: since.toISOString(), until: until.toISOString() };
  }, []);

  const [filter, setFilter] = useState<AdminFeedbackOverviewFilter>(initialFilter);
  const [drillTopic, setDrillTopic] = useState<string | null>(null);

  const overview = useAdminFeedbackOverview(filter);
  const pending = useAdminFeedbackPending();
  const approve = useApproveAdminFeedbackPending();
  const reject = useRejectAdminFeedbackPending();
  const drill = useAdminFeedbackMessages(
    { topic: drillTopic ?? undefined, rating: 'thumbsDown', pageSize: 25 },
    Boolean(drillTopic),
  );

  if (user?.role !== SystemRoles.ADMIN) {
    navigate('/c/new', { replace: true });
    return null;
  }

  if (overview.isLoading) {
    return <div className="p-8 text-center">…</div>;
  }

  if (overview.isError || !overview.data) {
    const message = (overview.error as Error | undefined)?.message ?? 'Error';
    return <div className="p-8 text-center text-red-600">{message}</div>;
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-xl font-semibold">
        {localize('com_admin_feedback_title')}
      </h1>
      <FilterBar value={filter} onChange={setFilter} onRefresh={() => overview.refetch()} />
      <KpiStrip kpis={overview.data.kpis} />
      <FeedbackTimeSeries points={overview.data.timeSeries} />
      <TopicTable rows={overview.data.byTopic} onSelect={setDrillTopic} />
      <ToolCallChart rows={overview.data.byTool} />
      <PendingTopicsQueue
        pending={pending.data?.pending ?? []}
        onApprove={(id) => approve.mutate({ id, rewrite: true })}
        onReject={(id) => reject.mutate(id)}
      />
      <FeedbackDrillDown
        topic={drillTopic}
        data={drill.data}
        loading={drill.isFetching}
        onClose={() => setDrillTopic(null)}
      />
    </main>
  );
}
