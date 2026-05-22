import { DryRunRecorder } from "../../src/services/dryRun";
import { DryRunReportModal } from "../../src/services/dryRunModal";

jest.mock("../../src/utils/logger", () => ({
  log: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

// The shared Obsidian mock exports `Setting` as a bare jest.fn() that
// doesn't support chaining. The modal's footer button setup needs
// `.addButton(...).addButton(...)`, so override the export to a real
// chainable class.
import * as obsidian from "obsidian";
beforeAll(() => {
  class FakeSetting {
    constructor(_el: HTMLElement) {}
    addButton(cb: (b: any) => any): this {
      const button = {
        setButtonText: () => button,
        setCta: () => button,
        onClick: () => button,
      };
      cb(button);
      return this;
    }
  }
  (obsidian as any).Setting = FakeSetting;
});

/**
 * Smoke tests for the dry-run modal.
 *
 * The modal is mostly DOM construction (jsdom can render it but the tests
 * stay focused on observable behavior: title text, count rows, detail rows,
 * empty-state). We exercise it directly rather than through full Obsidian
 * lifecycle — the real Modal base class is mocked in `tests/__mocks__/obsidian.ts`.
 */

describe("DryRunReportModal", () => {
  let mockApp: any;

  beforeEach(() => {
    mockApp = {};
  });

  it("renders a row for every outcome including zero-buckets", () => {
    const recorder = new DryRunRecorder();
    recorder.record({ outcome: "would-create", path: "Notes/a.md" });

    const modal = new DryRunReportModal(
      mockApp,
      recorder,
      new Date("2026-05-22T20:00:00Z"),
      new Date("2026-05-22T20:00:02Z")
    );
    modal.contentEl = document.createElement("div") as any;
    // Patch createEl helpers that Obsidian adds to HTMLElement
    patchObsidianDom(modal.contentEl);

    modal.onOpen();

    const items = modal.contentEl.querySelectorAll("li");
    expect(items.length).toBe(7); // 7 outcome rows, zero-buckets included

    const text = (modal.contentEl as HTMLElement).innerText ?? modal.contentEl.textContent ?? "";
    expect(text).toContain("Would create");
    expect(text).toContain("Would modify frontmatter");
    expect(text).toContain("Skip (body writes disabled)");
  });

  it("shows a row in the details table for each record", () => {
    const recorder = new DryRunRecorder();
    recorder.record({ outcome: "would-create", path: "Notes/a.md" });
    recorder.record({
      outcome: "would-modify",
      path: "Notes/b.md",
      granolaId: "uuid-b",
      reason: "remote newer",
    });
    recorder.record({
      outcome: "would-rename",
      path: "Notes/c.md",
      toPath: "Notes/c-renamed.md",
    });

    const modal = new DryRunReportModal(
      mockApp,
      recorder,
      new Date("2026-05-22T20:00:00Z"),
      new Date("2026-05-22T20:00:02Z")
    );
    modal.contentEl = document.createElement("div") as any;
    patchObsidianDom(modal.contentEl);

    modal.onOpen();

    const rows = modal.contentEl.querySelectorAll("tbody tr");
    expect(rows.length).toBe(3);

    const text = (modal.contentEl as HTMLElement).innerText ?? modal.contentEl.textContent ?? "";
    expect(text).toContain("Notes/a.md");
    expect(text).toContain("Notes/b.md");
    expect(text).toContain("granolaId=uuid-b");
    expect(text).toContain("remote newer");
    expect(text).toContain("Notes/c.md → Notes/c-renamed.md");
  });

  it("renders an empty-state when no records were captured", () => {
    const recorder = new DryRunRecorder();
    const modal = new DryRunReportModal(
      mockApp,
      recorder,
      new Date("2026-05-22T20:00:00Z"),
      new Date("2026-05-22T20:00:02Z")
    );
    modal.contentEl = document.createElement("div") as any;
    patchObsidianDom(modal.contentEl);

    modal.onOpen();

    expect(modal.contentEl.querySelector("tbody")).toBeNull();
    const text = modal.contentEl.textContent ?? "";
    expect(text).toContain("No changes would be made");
  });

  it("includes the elapsed-time hint with seconds rounded to one decimal", () => {
    const recorder = new DryRunRecorder();
    const modal = new DryRunReportModal(
      mockApp,
      recorder,
      new Date("2026-05-22T20:00:00Z"),
      new Date("2026-05-22T20:00:02.500Z")
    );
    modal.contentEl = document.createElement("div") as any;
    patchObsidianDom(modal.contentEl);

    modal.onOpen();

    const text = modal.contentEl.textContent ?? "";
    expect(text).toContain("took 2.5s");
    expect(text).toContain("No files were modified");
  });
});

/**
 * Adds Obsidian's `createEl` / `appendText` / `setText` / `empty` /
 * `addClass` helpers to a plain HTMLElement so tests can exercise the
 * modal's DOM construction code without dragging in the full Obsidian
 * runtime. Matches the surface used by the modal under test.
 */
function patchObsidianDom(root: HTMLElement): void {
  const addHelpers = (el: HTMLElement) => {
    const helpers = el as HTMLElement & {
      createEl: (
        tag: string,
        opts?: { text?: string; cls?: string }
      ) => HTMLElement;
      appendText: (s: string) => void;
      setText: (s: string) => void;
      empty: () => void;
      addClass: (s: string) => void;
    };
    if (typeof helpers.createEl !== "function") {
      helpers.createEl = (tag, opts) => {
        const child = document.createElement(tag);
        if (opts?.text) child.textContent = opts.text;
        if (opts?.cls) child.className = opts.cls;
        el.appendChild(child);
        addHelpers(child as HTMLElement);
        return child as HTMLElement;
      };
    }
    if (typeof helpers.appendText !== "function") {
      helpers.appendText = (s) => {
        el.appendChild(document.createTextNode(s));
      };
    }
    if (typeof helpers.setText !== "function") {
      helpers.setText = (s) => {
        el.textContent = s;
      };
    }
    if (typeof helpers.empty !== "function") {
      helpers.empty = () => {
        while (el.firstChild) el.removeChild(el.firstChild);
      };
    }
    if (typeof helpers.addClass !== "function") {
      helpers.addClass = (s) => el.classList.add(s);
    }
  };
  addHelpers(root);
}
