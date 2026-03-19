import { stringifyYaml } from "obsidian";

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
