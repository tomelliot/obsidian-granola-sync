import { filterDocumentsByDate } from "../../src/utils/documentFilter";
import { GranolaDoc } from "../../src/services/granolaApi";

// Mock dateUtils
jest.mock("../../src/utils/dateUtils");
import { getNoteDate } from "../../src/utils/dateUtils";

describe("documentFilter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("filterDocumentsByDate", () => {
    it("should return all documents when daysBack is 0", () => {
      const documents: GranolaDoc[] = [
        { id: "doc-1", title: "Note 1" },
        { id: "doc-2", title: "Note 2" },
        { id: "doc-3", title: "Note 3" },
      ];

      const result = filterDocumentsByDate(documents, 0);

      expect(result).toEqual(documents);
      expect(result.length).toBe(3);
      expect(getNoteDate).not.toHaveBeenCalled();
    });

    it("should filter documents older than daysBack", () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const fiveDaysAgo = new Date(today);
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
      const tenDaysAgo = new Date(today);
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

      const documents: GranolaDoc[] = [
        { id: "doc-1", title: "Recent Note" },
        { id: "doc-2", title: "Yesterday Note" },
        { id: "doc-3", title: "Old Note" },
      ];

      (getNoteDate as jest.Mock)
        .mockReturnValueOnce(today) // doc-1
        .mockReturnValueOnce(yesterday) // doc-2
        .mockReturnValueOnce(tenDaysAgo); // doc-3

      const result = filterDocumentsByDate(documents, 7);

      expect(result.length).toBe(2);
      expect(result).toEqual([documents[0], documents[1]]);
      expect(getNoteDate).toHaveBeenCalledTimes(3);
    });

    it("should include documents exactly at the cutoff date", () => {
      const today = new Date();
      const exactlySevenDaysAgo = new Date(today);
      exactlySevenDaysAgo.setDate(exactlySevenDaysAgo.getDate() - 7);

      const documents: GranolaDoc[] = [
        { id: "doc-1", title: "Cutoff Date Note" },
      ];

      (getNoteDate as jest.Mock).mockReturnValue(exactlySevenDaysAgo);

      const result = filterDocumentsByDate(documents, 7);

      expect(result.length).toBe(1);
      expect(result[0]).toEqual(documents[0]);
    });

    it("should exclude documents just before the cutoff date", () => {
      const today = new Date();
      const eightDaysAgo = new Date(today);
      eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

      const documents: GranolaDoc[] = [
        { id: "doc-1", title: "Too Old Note" },
      ];

      (getNoteDate as jest.Mock).mockReturnValue(eightDaysAgo);

      const result = filterDocumentsByDate(documents, 7);

      expect(result.length).toBe(0);
    });

    it("should return empty array when all documents are too old", () => {
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

      const documents: GranolaDoc[] = [
        { id: "doc-1", title: "Old Note 1" },
        { id: "doc-2", title: "Old Note 2" },
      ];

      (getNoteDate as jest.Mock)
        .mockReturnValueOnce(tenDaysAgo)
        .mockReturnValueOnce(tenDaysAgo);

      const result = filterDocumentsByDate(documents, 7);

      expect(result.length).toBe(0);
    });

    it("should return all documents when all are within range", () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const documents: GranolaDoc[] = [
        { id: "doc-1", title: "Recent Note 1" },
        { id: "doc-2", title: "Recent Note 2" },
      ];

      (getNoteDate as jest.Mock)
        .mockReturnValueOnce(today)
        .mockReturnValueOnce(yesterday);

      const result = filterDocumentsByDate(documents, 7);

      expect(result.length).toBe(2);
      expect(result).toEqual(documents);
    });

    it("should handle empty array", () => {
      const result = filterDocumentsByDate([], 7);

      expect(result).toEqual([]);
      expect(result.length).toBe(0);
    });

    it("should work with different daysBack values", () => {
      const today = new Date();
      const twoDaysAgo = new Date(today);
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      const threeDaysAgo = new Date(today);
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

      const documents: GranolaDoc[] = [
        { id: "doc-1", title: "Recent Note" },
        { id: "doc-2", title: "Older Note" },
      ];

      (getNoteDate as jest.Mock)
        .mockReturnValueOnce(twoDaysAgo)
        .mockReturnValueOnce(threeDaysAgo);

      // With daysBack = 1, neither should be included
      let result = filterDocumentsByDate(documents, 1);
      expect(result.length).toBe(0);

      // Reset mocks
      (getNoteDate as jest.Mock)
        .mockReturnValueOnce(twoDaysAgo)
        .mockReturnValueOnce(threeDaysAgo);

      // With daysBack = 3, first should be included
      result = filterDocumentsByDate(documents, 3);
      expect(result.length).toBe(2);
    });

    it("should handle large daysBack values", () => {
      const documents: GranolaDoc[] = [
        { id: "doc-1", title: "Note" },
      ];

      (getNoteDate as jest.Mock).mockReturnValue(new Date("2020-01-01"));

      const result = filterDocumentsByDate(documents, 365 * 10); // 10 years

      expect(result.length).toBe(1);
    });
  });
});
