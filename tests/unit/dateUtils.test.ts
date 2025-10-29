import { getNoteDate } from "../../src/utils/dateUtils";
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
