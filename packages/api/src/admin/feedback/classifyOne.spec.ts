import { classifyOne } from './classifyOne';
import { buildFakeLlm } from './fakeLlm';

const knownKeys = ['budget_ministries', 'takanon_sections', 'ethics'];

describe('classifyOne', () => {
  it('hits taxonomy when keyword matches', async () => {
    const llm = buildFakeLlm({ default: 'other:unmapped' });
    const result = await classifyOne(
      { userText: 'מה תקציב משרד החינוך?', knownKeys },
      { llm },
    );
    expect(result).toEqual({ topic: 'budget_ministries', source: 'taxonomy' });
  });

  it('falls back to LLM when taxonomy misses', async () => {
    const llm = buildFakeLlm({ 'סקירה': 'takanon_sections' });
    const result = await classifyOne(
      { userText: 'סקירה של הכנסת', knownKeys },
      { llm },
    );
    expect(result).toEqual({ topic: 'takanon_sections', source: 'llm' });
  });

  it('preserves other:<label> from LLM', async () => {
    const llm = buildFakeLlm({ default: 'other:meta_question' });
    const result = await classifyOne(
      { userText: 'בינה מלאכותית', knownKeys },
      { llm },
    );
    expect(result).toEqual({ topic: 'other:meta_question', source: 'llm' });
  });

  it('marks LLM garbage as llm-invalid', async () => {
    const llm = buildFakeLlm({ default: 'this is not a valid key' });
    const result = await classifyOne(
      { userText: 'שאלה כלשהי', knownKeys },
      { llm },
    );
    expect(result).toEqual({
      topic: 'unknown',
      source: 'llm-invalid',
      rawLlmResponse: 'this is not a valid key',
    });
  });

  it('returns unknown when user text is empty', async () => {
    const llm = buildFakeLlm({});
    const result = await classifyOne(
      { userText: '', knownKeys },
      { llm },
    );
    expect(result).toEqual({ topic: 'unknown', source: 'taxonomy' });
  });
});
