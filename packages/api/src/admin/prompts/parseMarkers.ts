export interface ParsedSection {
  sectionKey: string;
  ordinal: number;
  headerText: string;
  body: string;
}

const MARKER_RE = /^<!--\s*SECTION_KEY:\s*([a-z0-9_]+)\s*-->\s*$/;

export function parseMarkers(input: string): ParsedSection[] {
  const lines = input.split('\n');
  const sections: ParsedSection[] = [];
  let currentKey: string | null = null;
  let currentStart = -1;
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(MARKER_RE);
    if (!match) {
      if (currentKey === null && lines[i].trim().length > 0) {
        throw new Error('content before first SECTION_KEY');
      }
      continue;
    }
    const key = match[1];
    if (seen.has(key)) {
      throw new Error(`duplicate SECTION_KEY: ${key}`);
    }
    if (currentKey !== null) {
      sections.push(buildSection(currentKey, sections.length, lines, currentStart, i));
    }
    currentKey = key;
    currentStart = i + 1;
    seen.add(key);
  }
  if (currentKey !== null) {
    sections.push(
      buildSection(currentKey, sections.length, lines, currentStart, lines.length),
    );
  }
  return sections;
}

function buildSection(
  key: string,
  ordinal: number,
  lines: string[],
  start: number,
  end: number,
): ParsedSection {
  const body = lines.slice(start, end).join('\n');
  const headerLine = lines.slice(start, end).find((l) => l.startsWith('## '));
  return {
    sectionKey: key,
    ordinal,
    headerText: headerLine ?? '',
    body,
  };
}
