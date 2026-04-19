import { proposeClusters } from './proposeClusters';
import { buildFakeLlm } from './fakeLlm';

describe('proposeClusters', () => {
  it('calls LLM with the unique raw labels and parses JSON response', async () => {
    const rawLabels = ['other:תקציב חינוך', 'other:תקציב בריאות', 'other:מליאה'];
    const llmResponse = JSON.stringify([
      {
        proposedKey: 'sector_budget',
        labelHe: 'תקציב מגזרי',
        labelEn: 'Sector budget',
        rawLabels: ['other:תקציב חינוך', 'other:תקציב בריאות'],
      },
      {
        proposedKey: 'plenary',
        labelHe: 'מליאה',
        labelEn: 'Plenary',
        rawLabels: ['other:מליאה'],
      },
    ]);
    const llm = buildFakeLlm({ default: llmResponse });
    const result = await proposeClusters(rawLabels, { llm });
    expect(result).toHaveLength(2);
    expect(result[0].proposedKey).toBe('sector_budget');
  });

  it('returns [] when input is empty', async () => {
    const llm = buildFakeLlm({});
    expect(await proposeClusters([], { llm })).toEqual([]);
  });

  it('throws on malformed JSON', async () => {
    const llm = buildFakeLlm({ default: 'not json at all' });
    await expect(proposeClusters(['other:x'], { llm })).rejects.toThrow(/malformed/i);
  });
});
