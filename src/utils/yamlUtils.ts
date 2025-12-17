/**
 * Escapes a string for safe use as a YAML value.
 * Wraps the string in double quotes and escapes special characters.
 *
 * @param value - The string to escape
 * @returns A properly escaped YAML string value
 */
export function escapeYamlString(value: string): string {
  if (value === "") {
    return '""';
  }

  // Escape backslashes first, then double quotes
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  // Always wrap in double quotes to handle all special characters safely
  return `"${escaped}"`;
}

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
    "\n" + attendees.map((name) => `  - ${escapeYamlString(name)}`).join("\n")
  );
}
