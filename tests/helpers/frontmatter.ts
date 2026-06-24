import { parseYaml } from "obsidian";

/**
 * Extracts and parses the YAML frontmatter block from generated note content,
 * mirroring how Obsidian's metadataCache reads it.
 *
 * Throws if the frontmatter is missing or invalid YAML — which is precisely the
 * failure mode behind issue #139: a multi-line title serialized as an
 * unindented block scalar makes the whole frontmatter unparseable, so
 * `granola_id` becomes invisible to the metadata cache and deduplication
 * breaks. Tests assert against the parsed object so that any regression to
 * invalid YAML surfaces as a thrown error rather than passing silently.
 */
export function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    throw new Error("No YAML frontmatter block found in content");
  }
  return (parseYaml(match[1]) ?? {}) as Record<string, unknown>;
}

/**
 * Titles that previously produced invalid YAML frontmatter (issue #139) or that
 * exercise YAML-special characters. Each entry is [description, rawTitle].
 */
export const TRICKY_TITLES: ReadonlyArray<readonly [string, string]> = [
  ["mid-line newline (#139)", "WPT Leads IP Sprint Alignment\n — cycle planning with Lindsay"],
  ["leading newline", "\nMeeting Title With Leading Newline"],
  ["CRLF newline", "Line one\r\nLine two"],
  ["multiple blank lines", "Foo\n\n\nbar"],
  ["colon", "Project: Kickoff"],
  ["double quotes", 'Note with "quotes"'],
  ["leading dash", "- bullet-looking title"],
  ["leading hash", "#standup notes"],
];
