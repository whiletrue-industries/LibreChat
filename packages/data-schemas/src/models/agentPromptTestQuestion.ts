import agentPromptTestQuestionSchema from '~/schema/agentPromptTestQuestion';
import type { IAgentPromptTestQuestion } from '~/types/agentPrompt';

/**
 * Creates or returns the AgentPromptTestQuestion model using the provided mongoose instance and schema
 */
export function createAgentPromptTestQuestionModel(mongoose: typeof import('mongoose')) {
  return (
    mongoose.models.AgentPromptTestQuestion ||
    mongoose.model<IAgentPromptTestQuestion>(
      'AgentPromptTestQuestion',
      agentPromptTestQuestionSchema,
    )
  );
}
