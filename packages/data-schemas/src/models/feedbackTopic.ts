import feedbackTopicSchema from '~/schema/feedbackTopic';
import type { IFeedbackTopic } from '~/types/feedbackTopic';

/**
 * Creates or returns the FeedbackTopic model using the provided mongoose instance and schema
 */
export function createFeedbackTopicModel(mongoose: typeof import('mongoose')) {
  return (
    mongoose.models.FeedbackTopic ||
    mongoose.model<IFeedbackTopic>('FeedbackTopic', feedbackTopicSchema)
  );
}
