import { parse } from './parse';
import { assemble } from './assemble';
import type { AssembleSection } from './assemble';

const knownKeys = ['preamble', 'core', 'tools', 'a', 'b', 'c'] as const;

describe('parse', () => {
  it('round-trips with assemble for a simple two-section input', () => {
    const sections: AssembleSection[] = [
      { sectionKey: 'a', ordinal: 0, headerText: '', body: 'foo' },
      { sectionKey: 'b', ordinal: 1, headerText: '', body: 'bar' },
    ];
    const joined = assemble(sections);
    const parsed = parse(joined, knownKeys);
    expect(parsed).toEqual([
      { sectionKey: 'a', body: 'foo' },
      { sectionKey: 'b', body: 'bar' },
    ]);
  });

  it('round-trips a single section', () => {
    const sections: AssembleSection[] = [
      { sectionKey: 'a', ordinal: 0, headerText: '', body: 'only body' },
    ];
    const joined = assemble(sections);
    const parsed = parse(joined, knownKeys);
    expect(parsed).toEqual([{ sectionKey: 'a', body: 'only body' }]);
  });

  it('round-trips bodies containing internal newlines', () => {
    const sections: AssembleSection[] = [
      { sectionKey: 'a', ordinal: 0, headerText: '', body: 'line1\nline2\nline3' },
      { sectionKey: 'b', ordinal: 1, headerText: '', body: 'one\ntwo' },
    ];
    const joined = assemble(sections);
    const parsed = parse(joined, knownKeys);
    expect(parsed).toEqual([
      { sectionKey: 'a', body: 'line1\nline2\nline3' },
      { sectionKey: 'b', body: 'one\ntwo' },
    ]);
  });

  it('round-trips a body that ends with a trailing newline', () => {
    const sections: AssembleSection[] = [
      { sectionKey: 'a', ordinal: 0, headerText: '', body: 'foo\n' },
      { sectionKey: 'b', ordinal: 1, headerText: '', body: 'bar' },
    ];
    const joined = assemble(sections);
    const parsed = parse(joined, knownKeys);
    expect(parsed).toEqual([
      { sectionKey: 'a', body: 'foo\n' },
      { sectionKey: 'b', body: 'bar' },
    ]);
  });

  it('round-trips an empty body for a section', () => {
    const sections: AssembleSection[] = [
      { sectionKey: 'a', ordinal: 0, headerText: '', body: '' },
      { sectionKey: 'b', ordinal: 1, headerText: '', body: 'bar' },
    ];
    const joined = assemble(sections);
    const parsed = parse(joined, knownKeys);
    expect(parsed).toEqual([
      { sectionKey: 'a', body: '' },
      { sectionKey: 'b', body: 'bar' },
    ]);
  });

  it('preserves ordinal order in the output', () => {
    const sections: AssembleSection[] = [
      { sectionKey: 'c', ordinal: 0, headerText: '', body: 'C' },
      { sectionKey: 'a', ordinal: 1, headerText: '', body: 'A' },
      { sectionKey: 'b', ordinal: 2, headerText: '', body: 'B' },
    ];
    const joined = assemble(sections);
    const parsed = parse(joined, knownKeys);
    expect(parsed.map((s) => s.sectionKey)).toEqual(['c', 'a', 'b']);
  });

  it('throws when joined text contains an unknown SECTION_KEY', () => {
    const joined = '<!-- SECTION_KEY: a -->\nfoo\n\n<!-- SECTION_KEY: nope -->\nbar';
    expect(() => parse(joined, knownKeys)).toThrow(/unknown section_key.*nope/);
  });

  it('throws when there is content before the first SECTION_KEY marker', () => {
    const joined = 'stray text\n<!-- SECTION_KEY: a -->\nbody';
    expect(() => parse(joined, knownKeys)).toThrow(/before.*first.*SECTION_KEY/i);
  });

  it('throws when no SECTION_KEY markers are found', () => {
    const joined = 'just some text with no markers at all';
    expect(() => parse(joined, knownKeys)).toThrow(/no SECTION_KEY markers/);
  });

  it('throws on a duplicate SECTION_KEY', () => {
    const joined = '<!-- SECTION_KEY: a -->\nfirst body\n\n<!-- SECTION_KEY: a -->\nsecond body';
    expect(() => parse(joined, knownKeys)).toThrow(/duplicate section_key.*a/);
  });

  it('treats indented marker-shaped text as body content, not as a marker', () => {
    const body = '```\n    <!-- SECTION_KEY: imposter -->\n    code line\n```';
    const sections: AssembleSection[] = [
      { sectionKey: 'a', ordinal: 0, headerText: '', body },
      { sectionKey: 'b', ordinal: 1, headerText: '', body: 'after' },
    ];
    const joined = assemble(sections);
    const parsed = parse(joined, knownKeys);
    expect(parsed).toEqual([
      { sectionKey: 'a', body },
      { sectionKey: 'b', body: 'after' },
    ]);
  });

  it('detects a line-anchored marker that the user inadvertently typed inside a body', () => {
    const joined = '<!-- SECTION_KEY: a -->\nfoo\n<!-- SECTION_KEY: imposter -->\nbar';
    expect(() => parse(joined, knownKeys)).toThrow(/unknown section_key.*imposter/);
  });
});
