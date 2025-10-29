import { getNoteDate } from "../../src/utils/dateUtils";
import { GranolaDoc } from "../../src/services/granolaApi";

describe("getNoteDate", () => {
  describe("with created_at available", () => {
    it("should use created_at when available", () => {
      const doc: GranolaDoc = {
        id: "123",
        title: "Test Doc",
        created_at: "2024-01-15T10:30:00Z",
        updated_at: "2024-01-20T15:45:00Z",
      };
      const result = getNoteDate(doc);
      expect(result).toEqual(new Date("2024-01-15T10:30:00Z"));
    });

    it("should prefer created_at over updated_at", () => {
      const doc: GranolaDoc = {
        id: "123",
        title: "Test Doc",
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-12-31T23:59:59Z",
      };
      const result = getNoteDate(doc);
      expect(result).toEqual(new Date("2024-01-01T00:00:00Z"));
    });

    it("should handle created_at with timezone", () => {
      const doc: GranolaDoc = {
        id: "123",
        title: "Test Doc",
        created_at: "2024-06-15T14:30:00-05:00",
      };
      const result = getNoteDate(doc);
      expect(result).toEqual(new Date("2024-06-15T14:30:00-05:00"));
    });
  });

  describe("with only updated_at available", () => {
    it("should fall back to updated_at when created_at is missing", () => {
      const doc: GranolaDoc = {
        id: "123",
        title: "Test Doc",
        updated_at: "2024-01-20T15:45:00Z",
      };
      const result = getNoteDate(doc);
      expect(result).toEqual(new Date("2024-01-20T15:45:00Z"));
    });

    it("should handle updated_at with timezone", () => {
      const doc: GranolaDoc = {
        id: "123",
        title: "Test Doc",
        updated_at: "2024-06-15T14:30:00+03:00",
      };
      const result = getNoteDate(doc);
      expect(result).toEqual(new Date("2024-06-15T14:30:00+03:00"));
    });
  });

  describe("with neither date available", () => {
    it("should fall back to current date when both dates are missing", () => {
      const doc: GranolaDoc = {
        id: "123",
        title: "Test Doc",
      };
      const before = new Date();
      const result = getNoteDate(doc);
      const after = new Date();
      
      expect(result.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe("edge cases", () => {
    it("should handle empty string dates by falling back", () => {
      const doc: GranolaDoc = {
        id: "123",
        title: "Test Doc",
        created_at: "",
        updated_at: "",
      };
      // Empty strings create invalid dates, should fall back to current date
      const before = new Date();
      const result = getNoteDate(doc);
      const after = new Date();
      
      // Since empty strings don't create valid dates, should use current date
      expect(result.getTime()).toBeGreaterThanOrEqual(before.getTime() - 100);
      expect(result.getTime()).toBeLessThanOrEqual(after.getTime() + 100);
    });

    it("should handle ISO 8601 date formats", () => {
      const doc: GranolaDoc = {
        id: "123",
        title: "Test Doc",
        created_at: "2024-01-15",
      };
      const result = getNoteDate(doc);
      expect(result.toISOString()).toContain("2024-01-15");
    });

    it("should handle milliseconds in timestamp", () => {
      const doc: GranolaDoc = {
        id: "123",
        title: "Test Doc",
        created_at: "2024-01-15T10:30:00.123Z",
      };
      const result = getNoteDate(doc);
      expect(result).toEqual(new Date("2024-01-15T10:30:00.123Z"));
      expect(result.getMilliseconds()).toBe(123);
    });
  });
});
