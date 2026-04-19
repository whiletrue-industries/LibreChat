import agentPromptSchema from '~/schema/agentPrompt';
import type { IAgentPrompt } from '~/types/agentPrompt';

/**
 * Creates or returns the AgentPrompt model using the provided mongoose instance and schema
 */
export function createAgentPromptModel(mongoose: typeof import('mongoose')) {
  return (
    mongoose.models.AgentPrompt ||
    mongoose.model<IAgentPrompt>('AgentPrompt', agentPromptSchema)
  );
}
