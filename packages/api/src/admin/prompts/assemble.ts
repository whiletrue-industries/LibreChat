export interface AssembleSection {
  sectionKey: string;
  ordinal: number;
  headerText: string;
  body: string;
}

/**
 * Join an agent's prompt sections into the LLM-facing system prompt.
 *
 * Post-2026-05-08 (alembic 0010) the unified bot stores its prompt as a
 * single row with section_key='body', so the function returns that body
 * verbatim — no markers, no separators, no sentinel scaffolding. Empty
 * input collapses to the empty string. Anything else is a server-side
 * data shape we no longer expect; throwing surfaces it loudly instead
 * of silently emitting partial output.
 */
export function assemble(sections: AssembleSection[]): string {
  if (sections.length === 0) {
    return '';
  }
  if (sections.length > 1) {
    throw new Error(
      `assemble: expected at most one section after the 0010 collapse, ` +
        `got ${sections.length} (keys: ${sections.map((s) => s.sectionKey).join(', ')})`,
    );
  }
  return sections[0].body;
}
