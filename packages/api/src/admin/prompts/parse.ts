export interface ParsedPromptSection {
  sectionKey: string;
  body: string;
}

const MARKER_RE = /^<!--\s*SECTION_KEY:\s*([a-z0-9_]+)\s*-->\s*$/;

interface MarkerHit {
  key: string;
  lineIndex: number;
}

function findMarkers(lines: readonly string[]): MarkerHit[] {
  const hits: MarkerHit[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(MARKER_RE);
    if (!match) {
      continue;
    }
    hits.push({ key: match[1], lineIndex: i });
  }
  return hits;
}

function assertNoLeadingContent(lines: readonly string[], firstMarkerLine: number): void {
  for (let i = 0; i < firstMarkerLine; i += 1) {
    if (lines[i].trim().length > 0) {
      throw new Error('parse: content before the first SECTION_KEY marker');
    }
  }
}

function buildBody(
  lines: readonly string[],
  bodyStart: number,
  bodyEnd: number,
  hasNextMarker: boolean,
): string {
  const slice = lines.slice(bodyStart, bodyEnd);
  if (hasNextMarker && slice.length > 0 && slice[slice.length - 1] === '') {
    slice.pop();
  }
  return slice.join('\n');
}

export function parse(joined: string, knownKeys: readonly string[]): ParsedPromptSection[] {
  const lines = joined.split('\n');
  const markers = findMarkers(lines);
  if (markers.length === 0) {
    throw new Error('parse: no SECTION_KEY markers found in joined text');
  }
  assertNoLeadingContent(lines, markers[0].lineIndex);

  const knownKeySet = new Set(knownKeys);
  const seen = new Set<string>();
  const sections: ParsedPromptSection[] = [];

  for (let i = 0; i < markers.length; i += 1) {
    const { key, lineIndex } = markers[i];
    if (!knownKeySet.has(key)) {
      throw new Error(`parse: unknown section_key "${key}" — not in knownKeys`);
    }
    if (seen.has(key)) {
      throw new Error(`parse: duplicate section_key "${key}"`);
    }
    seen.add(key);

    const bodyStart = lineIndex + 1;
    const hasNext = i + 1 < markers.length;
    const bodyEnd = hasNext ? markers[i + 1].lineIndex : lines.length;
    const body = buildBody(lines, bodyStart, bodyEnd, hasNext);
    sections.push({ sectionKey: key, body });
  }

  return sections;
}
