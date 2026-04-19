const { AdminFeedback } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const { Message, FeedbackTopic, FeedbackTopicPending } = require('~/db/models');

async function getOverview(req, res) {
  try {
    const { since, until, endpoint, topic, tag } = req.query;
    const overview = await AdminFeedback.aggregateOverview({
      Message,
      since: since ? new Date(since) : undefined,
      until: until ? new Date(until) : undefined,
      endpoint,
      topic,
      tag,
    });
    const pendingTopicsCount = await FeedbackTopicPending.countDocuments({ status: 'pending' });
    res.status(200).json({ ...overview, pendingTopicsCount });
  } catch (error) {
    logger.error('[admin/feedback] overview failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getMessages(req, res) {
  try {
    const { topic, rating, cursor, pageSize } = req.query;
    const page = await AdminFeedback.listMessagesByFilter({
      Message,
      topic,
      rating,
      pageSize: pageSize ? Number(pageSize) : undefined,
      cursor,
    });
    res.status(200).json(page);
  } catch (error) {
    logger.error('[admin/feedback] drill-down failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function getPending(req, res) {
  try {
    const rows = await FeedbackTopicPending.find({ status: 'pending' })
      .sort({ proposedAt: -1 })
      .lean();
    res.status(200).json({ pending: rows });
  } catch (error) {
    logger.error('[admin/feedback] pending list failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function approvePending(req, res) {
  try {
    await AdminFeedback.approvePendingTopic({
      Message,
      Topic: FeedbackTopic,
      Pending: FeedbackTopicPending,
      pendingId: req.params.id,
      rewrite: req.query.rewrite !== 'false',
      reviewedBy: req.user.id,
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    logger.error('[admin/feedback] approve failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function rejectPending(req, res) {
  try {
    await FeedbackTopicPending.updateOne(
      { _id: req.params.id },
      {
        $set: {
          status: 'rejected',
          reviewedAt: new Date(),
          reviewedBy: req.user.id,
        },
      },
    );
    res.status(200).json({ ok: true });
  } catch (error) {
    logger.error('[admin/feedback] reject failed', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getOverview,
  getMessages,
  getPending,
  approvePending,
  rejectPending,
};
