import { assemble } from './assemble';

const sections = [
  { sectionKey: 'preamble', ordinal: 0, headerText: '', body: 'You are X.' },
  {
    sectionKey: 'core',
    ordinal: 1,
    headerText: '## Core',
    body: '## Core\n- be nice',
  },
];

describe('assemble', () => {
  it('joins sections in ordinal order with markers preserved', () => {
    const out = assemble(sections);
    expect(out).toBe(
      [
        '<!-- SECTION_KEY: preamble -->',
        'You are X.',
        '',
        '<!-- SECTION_KEY: core -->',
        '## Core',
        '- be nice',
      ].join('\n'),
    );
  });

  it('re-sorts by ordinal even when input is unsorted', () => {
    const shuffled = [sections[1], sections[0]];
    const out = assemble(shuffled);
    expect(out.indexOf('SECTION_KEY: preamble')).toBeLessThan(
      out.indexOf('SECTION_KEY: core'),
    );
  });

  it('returns empty string for empty input', () => {
    expect(assemble([])).toBe('');
  });
});
