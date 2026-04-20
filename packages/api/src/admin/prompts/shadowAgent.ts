export interface AgentSnapshot {
  id: string;
  name: string;
  model: string;
  provider: string;
  instructions: string;
  actions?: Array<{ domain: string; specHash: string }>;
}

export interface AgentsClient {
  getAgent(id: string): Promise<AgentSnapshot>;
  createAgent(input: Omit<AgentSnapshot, 'id'>): Promise<AgentSnapshot>;
  patchAgent(
    id: string,
    patch: Partial<Omit<AgentSnapshot, 'id'>>,
  ): Promise<AgentSnapshot>;
  deleteAgent(id: string): Promise<void>;
  chat(
    id: string,
    message: string,
  ): Promise<{ answer: string; toolCalls: unknown[] }>;
}

const TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  shadowId: string;
  instructionsKey: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export interface SpawnShadowInput {
  client: AgentsClient;
  liveAgentId: string;
  instructions: string;
  now?: number;
}

export async function spawnOrReuseShadow(input: SpawnShadowInput): Promise<string> {
  const now = input.now ?? Date.now();
  const entry = cache.get(input.liveAgentId);
  if (entry && entry.instructionsKey === input.instructions && entry.expiresAt > now) {
    return entry.shadowId;
  }
  if (entry) {
    await input.client.deleteAgent(entry.shadowId).catch(() => undefined);
  }
  const live = await input.client.getAgent(input.liveAgentId);
  const shadow = await input.client.createAgent({
    name: `${live.name} [shadow-${now}]`,
    model: live.model,
    provider: live.provider,
    instructions: input.instructions,
    actions: live.actions,
  });
  cache.set(input.liveAgentId, {
    shadowId: shadow.id,
    instructionsKey: input.instructions,
    expiresAt: now + TTL_MS,
  });
  return shadow.id;
}

export function clearShadowCache(): void {
  cache.clear();
}
