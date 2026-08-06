import { DEFAULT_SETTINGS, scrubRemovedSettings } from "../../src/settings";

describe("settings", () => {
  test("defaults include empty apiKey", () => {
    expect(DEFAULT_SETTINGS.apiKey).toBe("");
  });

  test("scrubRemovedSettings drops dead fields", () => {
    const loaded: Record<string, unknown> = {
      apiKey: "grn_x",
      includePrivateNotes: true,
      includeSharedNotes: false,
      syncNotes: true,
    };
    scrubRemovedSettings(loaded);
    expect(loaded).toEqual({ apiKey: "grn_x", syncNotes: true });
  });
});
