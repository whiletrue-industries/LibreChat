export interface ParsedPromptSection {
  sectionKey: string;
  body: string;
}

/**
 * Inverse of `assemble` for the post-2026-05-08 single-section world.
 *
 * The joined text the editor saves IS the body of the single
 * `(agent_type, section_key='body')` row. We pass it through as-is.
 *
 * `knownKeys` is the source of truth for the section_key to write to.
 * Callers always pass a single key (typically `'body'`); anything else
 * indicates the caller is still running pre-collapse and we throw to
 * surface the mismatch loudly instead of silently dropping data.
 */
export function parse(joined: string, knownKeys: readonly string[]): ParsedPromptSection[] {
  if (knownKeys.length !== 1) {
    throw new Error(
      `parse: expected exactly one knownKey after the 0010 collapse, ` +
        `got ${knownKeys.length} (keys: ${knownKeys.join(', ')})`,
    );
  }
  return [{ sectionKey: knownKeys[0], body: joined }];
}
