import feedbackTopicPendingSchema from '~/schema/feedbackTopicPending';
import type { IFeedbackTopicPending } from '~/types/feedbackTopic';

/**
 * Creates or returns the FeedbackTopicPending model using the provided mongoose instance and schema
 */
export function createFeedbackTopicPendingModel(mongoose: typeof import('mongoose')) {
  return (
    mongoose.models.FeedbackTopicPending ||
    mongoose.model<IFeedbackTopicPending>('FeedbackTopicPending', feedbackTopicPendingSchema)
  );
}
