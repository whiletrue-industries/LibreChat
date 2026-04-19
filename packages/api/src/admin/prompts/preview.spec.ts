import { runPreview } from './preview';
import { buildFakeAgentsClient } from './fakeAgentsClient';
import { clearShadowCache } from './shadowAgent';

describe('runPreview', () => {
  beforeEach(() => clearShadowCache());

  it('runs each test question against current + shadow and returns side-by-side', async () => {
    const client = buildFakeAgentsClient();
    const live = await client.createAgent({
      name: 'Live',
      model: 'gpt-x',
      instructions: 'LIVE',
    });
    const out = await runPreview({
      client,
      liveAgentId: live.id,
      draftInstructions: 'DRAFT',
      questions: ['Q1', 'Q2'],
      timeoutMs: 5000,
    });
    expect(out.questions).toHaveLength(2);
    expect(out.questions[0].text).toBe('Q1');
    expect(out.questions[0].current.answer).toContain(live.id);
    expect(out.questions[0].draft.answer).not.toContain(live.id);
  });

  it('marks per-question timeouts without aborting the whole run', async () => {
    const client = buildFakeAgentsClient();
    const live = await client.createAgent({
      name: 'Live',
      model: 'gpt-x',
      instructions: 'LIVE',
    });
    const slow = { ...client };
    slow.chat = (id, msg) =>
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 10),
      );
    const out = await runPreview({
      client: slow,
      liveAgentId: live.id,
      draftInstructions: 'DRAFT',
      questions: ['Q1'],
      timeoutMs: 50,
    });
    expect(out.questions[0].timedOut).toBe(true);
  });
});
