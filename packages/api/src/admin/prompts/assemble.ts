export interface AssembleSection {
  sectionKey: string;
  ordinal: number;
  headerText: string;
  body: string;
}

export function assemble(sections: AssembleSection[]): string {
  if (sections.length === 0) {
    return '';
  }
  const sorted = [...sections].sort((a, b) => a.ordinal - b.ordinal);
  const parts: string[] = [];
  for (const s of sorted) {
    parts.push(`<!-- SECTION_KEY: ${s.sectionKey} -->`);
    parts.push(s.body);
    parts.push('');
  }
  parts.pop();
  return parts.join('\n');
}
