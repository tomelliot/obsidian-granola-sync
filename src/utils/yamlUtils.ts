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

