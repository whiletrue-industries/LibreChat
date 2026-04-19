import { buildFakeLlm } from './fakeLlm';

describe('fakeLlm', () => {
  it('returns canned response when prefix matches', async () => {
    const llm = buildFakeLlm({
      'תקציב': 'budget_ministries',
      default: 'other:unmapped',
    });
    expect(await llm.classify('תקציב חינוך 2025', ['budget_ministries'])).toBe(
      'budget_ministries',
    );
    expect(await llm.classify('משהו אחר', ['budget_ministries'])).toBe(
      'other:unmapped',
    );
  });
});
