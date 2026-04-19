async function patchLibreChatAgent(agentsClient, agentType, instructions) {
  if (!agentsClient) {
    return;
  }
  await agentsClient.patchAgent('__placeholder__', { instructions });
}

module.exports = { patchLibreChatAgent };
