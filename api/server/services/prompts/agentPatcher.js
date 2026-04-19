async function patchLibreChatAgent(agentsClient, liveAgentIds, agentType, instructions) {
  if (!agentsClient) {
    return;
  }
  const id = (liveAgentIds || {})[agentType];
  if (!id) {
    throw new Error(`no live agent id configured for ${agentType}`);
  }
  await agentsClient.patchAgent(id, { instructions });
}

module.exports = { patchLibreChatAgent };
