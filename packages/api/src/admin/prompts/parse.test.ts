import { parse } from './parse';
import { assemble } from './assemble';
import type { AssembleSection } from './assemble';

describe('parse', () => {
  it('returns the joined text verbatim under the single body section_key', () => {
    expect(parse('hello world', ['body'])).toEqual([
      { sectionKey: 'body', body: 'hello world' },
    ]);
  });

  it('preserves all whitespace, newlines and special characters in the body', () => {
    const body = '## Heading\n\n* item 1\n* item 2\n\n```\nlet x = 1;\n```\n';
    expect(parse(body, ['body'])).toEqual([{ sectionKey: 'body', body }]);
  });

  it('returns the empty string body when joined text is empty', () => {
    expect(parse('', ['body'])).toEqual([{ sectionKey: 'body', body: '' }]);
  });

  it('uses whatever section_key the caller supplies', () => {
    expect(parse('foo', ['custom'])).toEqual([{ sectionKey: 'custom', body: 'foo' }]);
  });

  it('round-trips with assemble for any single-section payload', () => {
    const sections: AssembleSection[] = [
      { sectionKey: 'body', ordinal: 0, headerText: '', body: 'A\n\n---\n\nB' },
    ];
    expect(parse(assemble(sections), ['body'])).toEqual([
      { sectionKey: 'body', body: 'A\n\n---\n\nB' },
    ]);
  });

  it('throws when caller passes zero knownKeys (caller bug — section_key indeterminate)', () => {
    expect(() => parse('foo', [])).toThrow(/exactly one knownKey/);
  });

  it('throws when caller passes more than one knownKey (caller is pre-collapse)', () => {
    expect(() => parse('foo', ['a', 'b'])).toThrow(/exactly one knownKey/);
  });
});
