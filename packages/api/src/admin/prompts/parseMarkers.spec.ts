import { parseMarkers } from './parseMarkers';

describe('parseMarkers', () => {
  it('splits on SECTION_KEY markers and preserves body verbatim', () => {
    const input = [
      '<!-- SECTION_KEY: preamble -->',
      '<!-- Preamble — identity -->',
      'You are an assistant.',
      '',
      '<!-- SECTION_KEY: core -->',
      '## Core Characteristics',
      '- be nice',
    ].join('\n');

    const sections = parseMarkers(input);
    expect(sections).toHaveLength(2);
    expect(sections[0].sectionKey).toBe('preamble');
    expect(sections[0].body).toBe(
      '<!-- Preamble — identity -->\nYou are an assistant.\n',
    );
    expect(sections[1].sectionKey).toBe('core');
    expect(sections[1].headerText).toBe('## Core Characteristics');
    expect(sections[1].body).toBe('## Core Characteristics\n- be nice');
  });

  it('rejects duplicate keys', () => {
    const input = [
      '<!-- SECTION_KEY: same -->',
      'a',
      '<!-- SECTION_KEY: same -->',
      'b',
    ].join('\n');
    expect(() => parseMarkers(input)).toThrow(/duplicate SECTION_KEY/);
  });

  it('rejects body before first marker', () => {
    const input = 'stray text\n<!-- SECTION_KEY: k -->\nbody';
    expect(() => parseMarkers(input)).toThrow(/content before first SECTION_KEY/);
  });

  it('extracts an empty headerText when the body has no ## header', () => {
    const input = '<!-- SECTION_KEY: prose -->\njust some prose';
    const sections = parseMarkers(input);
    expect(sections[0].headerText).toBe('');
  });
});
