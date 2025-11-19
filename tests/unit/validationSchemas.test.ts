import * as v from "valibot";
import {
  GranolaDocSchema,
  GranolaApiResponseSchema,
} from "../../src/services/validationSchemas";

describe("Validation Schemas", () => {
  describe("GranolaDocSchema", () => {
    it("should accept valid document with all fields", () => {
      const validDoc = {
        id: "doc-123",
        title: "Meeting Notes",
        created_at: "2024-01-15T10:00:00Z",
        updated_at: "2024-01-15T12:00:00Z",
        people: {
          attendees: [
            { name: "John Doe", email: "john@example.com" },
            { name: "Jane Smith", email: "jane@example.com" },
          ],
        },
        last_viewed_panel: {
          content: "Some content",
        },
        tasks: [
          {
            task_definitions: [
              { name: "Task 1" },
              { name: null }, // null name should be accepted
            ],
          },
        ],
      };

      const result = v.safeParse(GranolaDocSchema, validDoc);
      expect(result.success).toBe(true);
    });

    it("should accept document with null people field", () => {
      const docWithNullPeople = {
        id: "doc-123",
        title: "Meeting Notes",
        people: null, // This was causing validation failures
      };

      const result = v.safeParse(GranolaDocSchema, docWithNullPeople);
      expect(result.success).toBe(true);
    });

    it("should accept document with null created_at", () => {
      const docWithNullDate = {
        id: "doc-123",
        title: "Meeting Notes",
        created_at: null,
        updated_at: null,
      };

      const result = v.safeParse(GranolaDocSchema, docWithNullDate);
      expect(result.success).toBe(true);
    });

    it("should accept document with null tasks", () => {
      const docWithNullTasks = {
        id: "doc-123",
        title: "Meeting Notes",
        tasks: null,
      };

      const result = v.safeParse(GranolaDocSchema, docWithNullTasks);
      expect(result.success).toBe(true);
    });

    it("should accept document with null task_definitions name", () => {
      const docWithNullTaskName = {
        id: "doc-123",
        title: "Meeting Notes",
        tasks: [
          {
            task_definitions: [
              { name: null }, // Issue #34 - name can be null
            ],
          },
        ],
      };

      const result = v.safeParse(GranolaDocSchema, docWithNullTaskName);
      expect(result.success).toBe(true);
    });

    it("should accept document with extra unknown fields", () => {
      const docWithExtraFields = {
        id: "doc-123",
        title: "Meeting Notes",
        someUnknownField: "value",
        anotherField: 123,
        nestedUnknown: { foo: "bar" },
      };

      const result = v.safeParse(GranolaDocSchema, docWithExtraFields);
      expect(result.success).toBe(true);
    });

    it("should require id field", () => {
      const docWithoutId = {
        title: "Meeting Notes",
      };

      const result = v.safeParse(GranolaDocSchema, docWithoutId);
      expect(result.success).toBe(false);
    });
  });

  describe("GranolaApiResponseSchema", () => {
    it("should accept response with docs field", () => {
      const responseWithDocs = {
        docs: [
          {
            id: "doc-1",
            title: "Note 1",
          },
          {
            id: "doc-2",
            title: "Note 2",
            people: null,
          },
        ],
      };

      const result = v.safeParse(GranolaApiResponseSchema, responseWithDocs);
      expect(result.success).toBe(true);
    });

    it("should accept response with data field", () => {
      const responseWithData = {
        data: [
          {
            id: "doc-1",
            title: "Note 1",
          },
        ],
      };

      const result = v.safeParse(GranolaApiResponseSchema, responseWithData);
      expect(result.success).toBe(true);
    });

    it("should accept response with both docs and data fields", () => {
      const responseWithBoth = {
        docs: [{ id: "doc-1", title: "Note 1" }],
        data: [{ id: "doc-2", title: "Note 2" }],
      };

      const result = v.safeParse(GranolaApiResponseSchema, responseWithBoth);
      expect(result.success).toBe(true);
    });

    it("should accept response with extra fields", () => {
      const responseWithExtra = {
        docs: [{ id: "doc-1", title: "Note 1" }],
        metadata: { total: 100 },
        pagination: { offset: 0, limit: 10 },
      };

      const result = v.safeParse(GranolaApiResponseSchema, responseWithExtra);
      expect(result.success).toBe(true);
    });
  });
});
