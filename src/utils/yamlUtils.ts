import { stringifyYaml } from "obsidian";

/**
 * Formats an array of attendee names as a YAML value.
 * Each attendee is properly escaped and formatted with proper indentation.
 *
 * @param attendees - Array of attendee names
 * @returns YAML-formatted string: "[]" for empty array, or newline + list items for non-empty array
 */
export function formatAttendeesAsYaml(attendees: string[]): string {
  if (attendees.length === 0) {
    return "[]";
  }

  return (
    "\n" +
    attendees.map((name) => `  - ${stringifyYaml(name).trim()}`).join("\n")
  );
}
