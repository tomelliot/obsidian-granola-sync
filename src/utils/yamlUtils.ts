import { stringifyYaml } from "obsidian";

/**
 * Builds the `title:` frontmatter line(s) for a note.
 *
 * The title is serialized by stringifying a single-key object rather than the
 * bare string. This matters for multi-line titles: Obsidian's `stringifyYaml`
 * (eemeli/yaml) renders a multi-line string as a block scalar, and only the
 * object form indents the continuation lines correctly. Serializing the bare
 * string and concatenating after `title: ` leaves continuation lines flush
 * against column 0, which is invalid YAML — Obsidian's metadataCache then
 * fails to parse the whole frontmatter, hiding `granola_id` and breaking
 * deduplication (see issue #139).
 *
 * @param title - The note title (may contain newlines or YAML-special characters)
 * @returns A valid YAML fragment, e.g. `title: Weekly Sync` or an indented
 *   `title: |-` block scalar, with no trailing newline.
 */
export function buildTitleYaml(title: string): string {
  return stringifyYaml({ title }).trimEnd();
}

/**
 * Formats an array of strings as a YAML list value.
 * Each item is properly escaped and formatted with proper indentation.
 *
 * @param items - Array of strings
 * @returns YAML-formatted string: "[]" for empty array, or newline + list items for non-empty array
 */
export function formatStringListAsYaml(items: string[]): string {
  if (items.length === 0) {
    return "[]";
  }

  return (
    "\n" +
    items.map((item) => `  - ${stringifyYaml(item).trim()}`).join("\n")
  );
}

/**
 * Formats an array of attendee names as a YAML value.
 * @param attendees - Array of attendee names
 * @returns YAML-formatted string
 */
export function formatAttendeesAsYaml(attendees: string[]): string {
  return formatStringListAsYaml(attendees);
}
