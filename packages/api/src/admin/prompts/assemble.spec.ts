import { assemble } from './assemble';

describe('assemble', () => {
  it('returns the body verbatim for a single-section input', () => {
    const sections = [
      { sectionKey: 'body', ordinal: 0, headerText: '', body: 'You are X.\n\nBe nice.' },
    ];
    expect(assemble(sections)).toBe('You are X.\n\nBe nice.');
  });

  it('returns the empty string for empty input', () => {
    expect(assemble([])).toBe('');
  });

  it('throws if more than one section is passed (post-collapse invariant)', () => {
    const sections = [
      { sectionKey: 'a', ordinal: 0, headerText: '', body: 'A' },
      { sectionKey: 'b', ordinal: 1, headerText: '', body: 'B' },
    ];
    expect(() => assemble(sections)).toThrow(/expected at most one section/);
  });

  it('never emits SECTION_KEY HTML comments', () => {
    const sections = [{ sectionKey: 'body', ordinal: 0, headerText: '', body: 'A' }];
    expect(assemble(sections)).not.toMatch(/SECTION_KEY/);
  });
});
