import { formatAttendeesAsYaml } from "../../src/utils/yamlUtils";

// Note: We assume Obsidian's stringifyYaml handles proper escaping of special characters.
// These tests focus on the formatting logic (newlines, indentation, list structure).

describe("formatAttendeesAsYaml", () => {
  it("should format a single attendee with leading newline", () => {
    expect(formatAttendeesAsYaml(["Alice"])).toBe("\n  - Alice");
  });

  it("should format multiple attendees with leading newline", () => {
    const result = formatAttendeesAsYaml(["Alice", "Bob Smith", "Carol"]);
    expect(result).toBe("\n  - Alice\n  - Bob Smith\n  - Carol");
  });

  it("should return [] for empty array", () => {
    expect(formatAttendeesAsYaml([])).toBe("[]");
  });

  it("should maintain proper indentation for all items", () => {
    const result = formatAttendeesAsYaml(["A", "B", "C"]);
    const lines = result.split("\n");
    // First line is empty (the leading newline), then 3 items
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe("");
    lines.slice(1).forEach((line) => {
      expect(line.startsWith("  - ")).toBe(true);
    });
  });
});
