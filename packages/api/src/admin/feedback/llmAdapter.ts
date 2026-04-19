export interface LlmAdapter {
  classify(prompt: string, knownKeys: string[]): Promise<string>;
}

export function buildOpenAiLlm(apiKey: string, model = 'gpt-4o-mini'): LlmAdapter {
  return {
    async classify(prompt: string, knownKeys: string[]): Promise<string> {
      const system = [
        'You classify Hebrew questions into topic keys for a product-feedback dashboard.',
        `Known keys: ${knownKeys.join(', ')}.`,
        'Respond with EXACTLY one of: a known key, or `other:<short_hebrew_label>`.',
        'No explanation, no quotes, one token on a single line.',
      ].join(' ');
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          temperature: 0,
          max_tokens: 40,
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`LLM HTTP ${response.status}: ${text.slice(0, 200)}`);
      }
      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      return data.choices[0].message.content.trim();
    },
  };
}
