import { Notice } from "obsidian";
import { notifySync } from "../../src/utils/notify";

// `Notice` is the manual mock from tests/__mocks__/obsidian.ts (a jest.fn()).
const NoticeMock = Notice as unknown as jest.Mock;

describe("notifySync", () => {
  beforeEach(() => {
    NoticeMock.mockClear();
  });

  it("shows a notice when sync notifications are enabled", () => {
    notifySync(true, "Granola sync: Manual sync complete.");

    expect(NoticeMock).toHaveBeenCalledTimes(1);
    expect(NoticeMock).toHaveBeenCalledWith(
      "Granola sync: Manual sync complete.",
      undefined
    );
  });

  it("forwards the timeout argument to Notice", () => {
    notifySync(true, "Granola sync: No documents found.", 5000);

    expect(NoticeMock).toHaveBeenCalledWith(
      "Granola sync: No documents found.",
      5000
    );
  });

  it("returns the created Notice when enabled", () => {
    const result = notifySync(true, "Granola sync: Starting manual sync.");

    expect(result).not.toBeNull();
  });

  it("suppresses the notice when sync notifications are disabled", () => {
    const result = notifySync(false, "Granola sync: Manual sync complete.");

    expect(NoticeMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
