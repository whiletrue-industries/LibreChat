import type { FilterQuery, Model, PipelineStage } from 'mongoose';

export interface OverviewFilter {
  Message: Model<unknown>;
  since?: Date;
  until?: Date;
  endpoint?: string;
  topic?: string;
  tag?: string;
}

export interface Kpis {
  total: number;
  withFeedback: number;
  feedbackRate: number | null;
  thumbsUp: number;
  thumbsDown: number;
  positivePct: number | null;
}

export interface TimeSeriesPoint {
  date: string;
  total: number;
  withFeedback: number;
  up: number;
  down: number;
}

export interface TopicRow {
  topic: string;
  total: number;
  withFeedback: number;
  positivePct: number | null;
  lastThumbsDownAt: Date | null;
}

export interface ToolRow {
  toolName: string;
  total: number;
  thumbsDown: number;
}

export interface OverviewResponse {
  range: { since: Date | null; until: Date | null };
  kpis: Kpis;
  timeSeries: TimeSeriesPoint[];
  byTopic: TopicRow[];
  byTool: ToolRow[];
}

interface KpisGroupResult {
  _id: null;
  total: number;
  withFeedback: number;
  thumbsUp: number;
  thumbsDown: number;
}

interface TopicGroupResult {
  _id: string;
  total: number;
  withFeedback: number;
  thumbsUp: number;
  thumbsDown: number;
  lastThumbsDownAt: Date | null;
}

interface ToolGroupResult {
  _id: string;
  total: number;
  thumbsDown: number;
}

interface TimeGroupResult {
  _id: string;
  total: number;
  withFeedback: number;
  up: number;
  down: number;
}

interface FacetResult {
  kpis: KpisGroupResult[];
  timeSeries: TimeGroupResult[];
  byTopic: TopicGroupResult[];
  byTool: ToolGroupResult[];
}

function buildMatch(filter: OverviewFilter): FilterQuery<Record<string, unknown>> {
  const match: FilterQuery<Record<string, unknown>> = { isCreatedByUser: false };
  if (filter.endpoint) {
    match.endpoint = filter.endpoint;
  }
  if (filter.topic) {
    match['feedback.topic'] = filter.topic;
  }
  if (filter.tag) {
    match['feedback.tag.key'] = filter.tag;
  }
  if (filter.since != null || filter.until != null) {
    const range: Record<string, Date> = {};
    if (filter.since != null) range.$gte = filter.since;
    if (filter.until != null) range.$lt = filter.until;
    match.createdAt = range;
  }
  return match;
}

function computeTopicRow(t: TopicGroupResult): TopicRow {
  return {
    topic: t._id,
    total: t.total,
    withFeedback: t.withFeedback,
    positivePct:
      t.withFeedback > 0
        ? Number(((t.thumbsUp / t.withFeedback) * 100).toFixed(2))
        : null,
    lastThumbsDownAt: t.lastThumbsDownAt,
  };
}

export async function aggregateOverview(filter: OverviewFilter): Promise<OverviewResponse> {
  const match = buildMatch(filter);

  const pipeline: PipelineStage[] = [
    { $match: match },
    {
      $facet: {
        kpis: [
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              withFeedback: {
                $sum: { $cond: [{ $ifNull: ['$feedback', false] }, 1, 0] },
              },
              thumbsUp: {
                $sum: { $cond: [{ $eq: ['$feedback.rating', 'thumbsUp'] }, 1, 0] },
              },
              thumbsDown: {
                $sum: { $cond: [{ $eq: ['$feedback.rating', 'thumbsDown'] }, 1, 0] },
              },
            },
          },
        ],
        timeSeries: [
          { $match: { feedback: { $exists: true } } },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              total: { $sum: 1 },
              withFeedback: { $sum: 1 },
              up: {
                $sum: { $cond: [{ $eq: ['$feedback.rating', 'thumbsUp'] }, 1, 0] },
              },
              down: {
                $sum: { $cond: [{ $eq: ['$feedback.rating', 'thumbsDown'] }, 1, 0] },
              },
            },
          },
          { $sort: { _id: 1 } },
        ],
        byTopic: [
          { $match: { 'feedback.topic': { $exists: true } } },
          {
            $group: {
              _id: '$feedback.topic',
              total: { $sum: 1 },
              withFeedback: { $sum: 1 },
              thumbsUp: {
                $sum: { $cond: [{ $eq: ['$feedback.rating', 'thumbsUp'] }, 1, 0] },
              },
              thumbsDown: {
                $sum: { $cond: [{ $eq: ['$feedback.rating', 'thumbsDown'] }, 1, 0] },
              },
              lastThumbsDownAt: {
                $max: {
                  $cond: [{ $eq: ['$feedback.rating', 'thumbsDown'] }, '$createdAt', null],
                },
              },
            },
          },
          { $sort: { total: -1 } },
        ],
        byTool: [
          { $match: { content: { $elemMatch: { type: 'tool_call' } } } },
          { $unwind: '$content' },
          { $match: { 'content.type': 'tool_call' } },
          {
            $group: {
              _id: '$content.tool_call.name',
              total: { $sum: 1 },
              thumbsDown: {
                $sum: { $cond: [{ $eq: ['$feedback.rating', 'thumbsDown'] }, 1, 0] },
              },
            },
          },
          { $sort: { thumbsDown: -1 } },
          { $limit: 10 },
        ],
      },
    },
  ];

  const [row] = (await filter.Message.aggregate(pipeline)) as FacetResult[];

  const kpisRaw = row?.kpis?.[0] ?? {
    total: 0,
    withFeedback: 0,
    thumbsUp: 0,
    thumbsDown: 0,
  };

  const feedbackRate =
    kpisRaw.total > 0
      ? Number(((kpisRaw.withFeedback / kpisRaw.total) * 100).toFixed(2))
      : null;
  const positivePct =
    kpisRaw.withFeedback > 0
      ? Number(((kpisRaw.thumbsUp / kpisRaw.withFeedback) * 100).toFixed(2))
      : null;

  const byTopic = (row?.byTopic ?? []).map(computeTopicRow);

  const byTool: ToolRow[] = (row?.byTool ?? []).map((t) => ({
    toolName: t._id,
    total: t.total,
    thumbsDown: t.thumbsDown,
  }));

  const timeSeries: TimeSeriesPoint[] = (row?.timeSeries ?? []).map((p) => ({
    date: p._id,
    total: p.total,
    withFeedback: p.withFeedback,
    up: p.up,
    down: p.down,
  }));

  return {
    range: { since: filter.since ?? null, until: filter.until ?? null },
    kpis: { ...kpisRaw, feedbackRate, positivePct },
    timeSeries,
    byTopic,
    byTool,
  };
}
