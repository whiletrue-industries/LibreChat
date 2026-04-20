const { updateAgent } = require('~/models/Agent');

async function patchLibreChatAgent(liveAgentIds, agentType, instructions) {
  const id = (liveAgentIds || {})[agentType];
  if (!id) {
    throw new Error(`no live agent id configured for ${agentType}`);
  }
  await updateAgent({ id }, { instructions });
}

module.exports = { patchLibreChatAgent };
