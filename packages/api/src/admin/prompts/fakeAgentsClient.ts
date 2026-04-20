import type { AgentsClient, AgentSnapshot } from './shadowAgent';

export interface FakeAgentsClient extends AgentsClient {
  _snapshots: AgentSnapshot[];
}

export function buildFakeAgentsClient(): FakeAgentsClient {
  const store = new Map<string, AgentSnapshot>();
  const history: AgentSnapshot[] = [];
  let counter = 0;
  return {
    _snapshots: history,
    async getAgent(agentId) {
      const a = store.get(agentId);
      if (!a) {
        throw new Error(`agent ${agentId} not found`);
      }
      return a;
    },
    async createAgent(input) {
      counter += 1;
      const snap: AgentSnapshot = { id: `agent_${counter}`, ...input };
      store.set(snap.id, snap);
      history.push(snap);
      return snap;
    },
    async patchAgent(agentId, patch) {
      const a = store.get(agentId);
      if (!a) {
        throw new Error(`agent ${agentId} not found`);
      }
      const next: AgentSnapshot = { ...a, ...patch };
      store.set(agentId, next);
      history.push(next);
      return next;
    },
    async deleteAgent(agentId) {
      store.delete(agentId);
    },
    async chat(agentId, message) {
      return {
        answer: `fake-answer[${agentId}]: ${message}`,
        toolCalls: [],
      };
    },
  };
}
