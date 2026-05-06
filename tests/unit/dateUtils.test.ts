import {
  getNoteDate,
  formatDateForFilename,
  getEffectiveUpdatedAt,
} from "../../src/utils/dateUtils";
import { GranolaDoc } from "../../src/services/granolaApi";

describe("getNoteDate", () => {
  it("should use created_at when available", () => {
    const doc: GranolaDoc = {
      id: "test-id",
      title: "Test Doc",
      created_at: "2024-01-15T10:30:00Z",
      updated_at: "2024-01-20T15:45:00Z",
    };

    const result = getNoteDate(doc);
    expect(result).toEqual(new Date("2024-01-15T10:30:00Z"));
  });

  it("should fall back to updated_at when created_at is missing", () => {
    const doc: GranolaDoc = {
      id: "test-id",
      title: "Test Doc",
      updated_at: "2024-01-20T15:45:00Z",
    };

    const result = getNoteDate(doc);
    expect(result).toEqual(new Date("2024-01-20T15:45:00Z"));
  });

  it("should fall back to current date when both dates are missing", () => {
    const doc: GranolaDoc = {
      id: "test-id",
      title: "Test Doc",
    };

    const before = new Date();
    const result = getNoteDate(doc);
    const after = new Date();

    // The result should be between before and after (with some tolerance)
    expect(result.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(result.getTime()).toBeLessThanOrEqual(after.getTime() + 100);
  });

  it("should prefer created_at over updated_at when both are present", () => {
    const doc: GranolaDoc = {
      id: "test-id",
      title: "Test Doc",
      created_at: "2024-01-10T08:00:00Z",
      updated_at: "2024-01-25T12:00:00Z",
    };

    const result = getNoteDate(doc);
    expect(result).toEqual(new Date("2024-01-10T08:00:00Z"));
  });

  it("should handle empty strings in created_at by falling back to updated_at", () => {
    const doc: GranolaDoc = {
      id: "test-id",
      title: "Test Doc",
      created_at: "",
      updated_at: "2024-01-20T15:45:00Z",
    };

    const result = getNoteDate(doc);
    expect(result).toEqual(new Date("2024-01-20T15:45:00Z"));
  });

  it("should handle empty strings in both dates by falling back to current date", () => {
    const doc: GranolaDoc = {
      id: "test-id",
      title: "Test Doc",
      created_at: "",
      updated_at: "",
    };

    const before = new Date();
    const result = getNoteDate(doc);
    const after = new Date();

    expect(result.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(result.getTime()).toBeLessThanOrEqual(after.getTime() + 100);
  });

  it("should handle invalid date strings by returning Invalid Date", () => {
    const doc: GranolaDoc = {
      id: "test-id",
      title: "Test Doc",
      created_at: "not-a-valid-date",
    };

    const result = getNoteDate(doc);
    expect(isNaN(result.getTime())).toBe(true);
  });
});

describe("getEffectiveUpdatedAt", () => {
  it("returns the panel timestamp when it is later than the doc timestamp", () => {
    const doc: GranolaDoc = {
      id: "test-id",
      title: "Test Doc",
      updated_at: "2026-05-06T09:09:44.023Z",
      last_viewed_panel: {
        content: null,
        updated_at: "2026-05-06T09:54:57.535Z",
      },
    };
    expect(getEffectiveUpdatedAt(doc)).toBe("2026-05-06T09:54:57.535Z");
  });

  it("returns the doc timestamp when it is later than the panel timestamp", () => {
    const doc: GranolaDoc = {
      id: "test-id",
      title: "Test Doc",
      updated_at: "2026-05-06T10:00:00.000Z",
      last_viewed_panel: {
        content: null,
        updated_at: "2026-05-06T09:54:57.535Z",
      },
    };
    expect(getEffectiveUpdatedAt(doc)).toBe("2026-05-06T10:00:00.000Z");
  });

  it("falls back to doc updated_at when panel updated_at is missing", () => {
    const doc: GranolaDoc = {
      id: "test-id",
      title: "Test Doc",
      updated_at: "2026-05-06T09:09:44.023Z",
      last_viewed_panel: { content: null },
    };
    expect(getEffectiveUpdatedAt(doc)).toBe("2026-05-06T09:09:44.023Z");
  });

  it("falls back to panel updated_at when doc updated_at is missing", () => {
    const doc: GranolaDoc = {
      id: "test-id",
      title: "Test Doc",
      last_viewed_panel: {
        content: null,
        updated_at: "2026-05-06T09:54:57.535Z",
      },
    };
    expect(getEffectiveUpdatedAt(doc)).toBe("2026-05-06T09:54:57.535Z");
  });

  it("returns undefined when neither timestamp is present", () => {
    const doc: GranolaDoc = { id: "test-id", title: "Test Doc" };
    expect(getEffectiveUpdatedAt(doc)).toBeUndefined();
  });

  it("ignores an unparseable panel timestamp and returns the doc timestamp", () => {
    const doc: GranolaDoc = {
      id: "test-id",
      title: "Test Doc",
      updated_at: "2026-05-06T09:09:44.023Z",
      last_viewed_panel: { content: null, updated_at: "not-a-date" },
    };
    expect(getEffectiveUpdatedAt(doc)).toBe("2026-05-06T09:09:44.023Z");
  });
});

describe("formatDateForFilename", () => {
  it("should format date with correct pattern YYYY-MM-DD HH-MM-SS", () => {
    const date = new Date(2024, 0, 15, 10, 30, 45); // Use local time
    const result = formatDateForFilename(date);
    expect(result).toBe("2024-01-15 10-30-45");
  });

  it("should pad single digit months, days, hours, minutes, and seconds with zeros", () => {
    const date = new Date(2024, 2, 5, 8, 7, 3);
    const result = formatDateForFilename(date);
    expect(result).toBe("2024-03-05 08-07-03");
  });

  it("should produce filename-safe strings (no colons or slashes)", () => {
    const date = new Date(2024, 6, 20, 14, 45);
    const result = formatDateForFilename(date);
    expect(result).not.toContain(":");
    expect(result).not.toContain("/");
    expect(result).toMatch(/^[\w\s-]+$/); // Only word chars, spaces, and hyphens
  });
});
