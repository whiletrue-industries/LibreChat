import { spawnOrReuseShadow, clearShadowCache } from './shadowAgent';
import { buildFakeAgentsClient } from './fakeAgentsClient';

describe('spawnOrReuseShadow', () => {
  beforeEach(() => clearShadowCache());

  it('creates a shadow on first call', async () => {
    const client = buildFakeAgentsClient();
    const live = await client.createAgent({
      name: 'Live',
      model: 'gpt-x',
      provider: 'openAI',
      instructions: 'live',
    });
    const id = await spawnOrReuseShadow({
      client,
      liveAgentId: live.id,
      instructions: 'draft-v1',
    });
    const shadow = await client.getAgent(id);
    expect(shadow.instructions).toBe('draft-v1');
  });

  it('reuses the shadow when instructions unchanged and within TTL', async () => {
    const client = buildFakeAgentsClient();
    const live = await client.createAgent({
      name: 'Live',
      model: 'gpt-x',
      provider: 'openAI',
      instructions: 'live',
    });
    const a = await spawnOrReuseShadow({
      client,
      liveAgentId: live.id,
      instructions: 'draft-v1',
    });
    const b = await spawnOrReuseShadow({
      client,
      liveAgentId: live.id,
      instructions: 'draft-v1',
    });
    expect(a).toBe(b);
  });

  it('tears down + recreates when instructions differ', async () => {
    const client = buildFakeAgentsClient();
    const live = await client.createAgent({
      name: 'Live',
      model: 'gpt-x',
      provider: 'openAI',
      instructions: 'live',
    });
    const a = await spawnOrReuseShadow({
      client,
      liveAgentId: live.id,
      instructions: 'draft-v1',
    });
    const b = await spawnOrReuseShadow({
      client,
      liveAgentId: live.id,
      instructions: 'draft-v2',
    });
    expect(a).not.toBe(b);
    await expect(client.getAgent(a)).rejects.toThrow();
  });
});
