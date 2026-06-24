import { parseYaml } from "obsidian";
import {
  buildTitleYaml,
  formatAttendeesAsYaml,
} from "../../src/utils/yamlUtils";
import { TRICKY_TITLES } from "../helpers/frontmatter";

// Note: stringifyYaml/parseYaml are backed by the real `yaml` library in tests
// (see tests/__mocks__/obsidian.ts), so these exercise real YAML serialization.

describe("buildTitleYaml", () => {
  it("emits a plain scalar for a simple single-line title", () => {
    expect(buildTitleYaml("Weekly Sync")).toBe("title: Weekly Sync");
  });

  it("indents a multi-line title as a block scalar (issue #139)", () => {
    const out = buildTitleYaml("Foo\n — bar");
    // The fix: continuation lines are indented under the key, not flush-left.
    // The old `title: ${stringifyYaml(t).trim()}` produced a flush-left block
    // scalar, which is invalid YAML.
    expect(out).toBe("title: |-\n  Foo\n   — bar");
    out.split("\n").slice(1).forEach((line) => {
      expect(line.startsWith("  ")).toBe(true);
    });
  });

  it.each(TRICKY_TITLES)(
    "round-trips a title with %s through a YAML parse",
    (_label, title) => {
      const parsed = parseYaml(buildTitleYaml(title)) as { title: string };
      expect(parsed.title).toBe(title);
    }
  );
});

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
