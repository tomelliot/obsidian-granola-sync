import {
  importLegacySettings,
  looksLikeGranolaSyncSettings,
  hasNoExistingSettings,
  LEGACY_PLUGIN_IDS,
  DataAdapterLike,
} from "../../src/services/legacySettingsImport";

const CONFIG_DIR = ".obsidian";

/** Builds an adapter backed by a path -> file contents map. */
function makeAdapter(files: Record<string, string>): DataAdapterLike {
  return {
    exists: jest.fn(async (path: string) =>
      Object.prototype.hasOwnProperty.call(files, path)
    ),
    read: jest.fn(async (path: string) => {
      if (!Object.prototype.hasOwnProperty.call(files, path)) {
        throw new Error(`ENOENT: ${path}`);
      }
      return files[path];
    }),
  };
}

function dataPath(pluginId: string): string {
  return `${CONFIG_DIR}/plugins/${pluginId}/data.json`;
}

/** A realistic settings blob written by this plugin under its old id. */
const OUR_SETTINGS = {
  apiKey: "grn_abc123",
  syncNotes: true,
  saveAsIndividualFiles: true,
  baseFolderType: "custom",
  customBaseFolder: "Granola",
  subfolderPattern: "none",
  filenamePattern: "{title}",
  transcriptHandling: "custom-location",
  titleFilterMode: "disabled",
  latestSyncTime: 1_700_000_000,
};

describe("looksLikeGranolaSyncSettings", () => {
  it("accepts settings written by this plugin", () => {
    expect(looksLikeGranolaSyncSettings(OUR_SETTINGS)).toBe(true);
  });

  it("accepts legacy pre-rewrite settings via syncDestination", () => {
    expect(
      looksLikeGranolaSyncSettings({
        syncDestination: "daily_notes",
        dailyNoteSectionHeading: "# Granola notes",
      })
    ).toBe(true);
  });

  it("rejects a different plugin's data.json that happens to share the folder", () => {
    // The community-store plugin registered under id "granola-api-sync".
    expect(
      looksLikeGranolaSyncSettings({
        apiKey: "grn_xyz",
        outputFolder: "Meetings",
        includeTranscript: true,
        lastSync: "2026-07-17T00:00:00Z",
      })
    ).toBe(false);
  });

  it("rejects a lone shared key", () => {
    expect(looksLikeGranolaSyncSettings({ apiKey: "grn_xyz" })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(looksLikeGranolaSyncSettings(null)).toBe(false);
    expect(looksLikeGranolaSyncSettings("string")).toBe(false);
    expect(looksLikeGranolaSyncSettings([OUR_SETTINGS])).toBe(false);
  });
});

describe("hasNoExistingSettings", () => {
  it("is true for a fresh install", () => {
    expect(hasNoExistingSettings(null)).toBe(true);
    expect(hasNoExistingSettings(undefined)).toBe(true);
    expect(hasNoExistingSettings({})).toBe(true);
  });

  it("is false once any setting is present", () => {
    expect(hasNoExistingSettings({ syncNotes: false })).toBe(false);
  });
});

describe("importLegacySettings", () => {
  it("imports settings from the previous plugin id", async () => {
    const adapter = makeAdapter({
      [dataPath("granola-api-sync")]: JSON.stringify(OUR_SETTINGS),
    });

    const result = await importLegacySettings(adapter, CONFIG_DIR);

    expect(result).not.toBeNull();
    expect(result?.pluginId).toBe("granola-api-sync");
    expect(result?.settings).toEqual(OUR_SETTINGS);
  });

  it("does not import a colliding plugin's settings", async () => {
    const adapter = makeAdapter({
      [dataPath("granola-api-sync")]: JSON.stringify({
        apiKey: "grn_xyz",
        outputFolder: "Meetings",
      }),
    });

    expect(await importLegacySettings(adapter, CONFIG_DIR)).toBeNull();
  });

  it("falls back to the upstream plugin id when the newer folder is not ours", async () => {
    const adapter = makeAdapter({
      [dataPath("granola-api-sync")]: JSON.stringify({ outputFolder: "x" }),
      [dataPath("granola-sync")]: JSON.stringify(OUR_SETTINGS),
    });

    const result = await importLegacySettings(adapter, CONFIG_DIR);

    expect(result?.pluginId).toBe("granola-sync");
  });

  it("prefers the most recent plugin id when both folders are ours", async () => {
    const adapter = makeAdapter({
      [dataPath("granola-api-sync")]: JSON.stringify({
        ...OUR_SETTINGS,
        customBaseFolder: "Newer",
      }),
      [dataPath("granola-sync")]: JSON.stringify({
        ...OUR_SETTINGS,
        customBaseFolder: "Older",
      }),
    });

    const result = await importLegacySettings(adapter, CONFIG_DIR);

    expect(result?.pluginId).toBe("granola-api-sync");
    expect(result?.settings.customBaseFolder).toBe("Newer");
  });

  it("returns null when no legacy folder exists", async () => {
    expect(await importLegacySettings(makeAdapter({}), CONFIG_DIR)).toBeNull();
  });

  it("skips malformed JSON rather than throwing", async () => {
    const adapter = makeAdapter({
      [dataPath("granola-api-sync")]: "{ not json",
      [dataPath("granola-sync")]: JSON.stringify(OUR_SETTINGS),
    });

    const result = await importLegacySettings(adapter, CONFIG_DIR);

    expect(result?.pluginId).toBe("granola-sync");
  });

  it("survives an adapter that throws on read", async () => {
    const adapter: DataAdapterLike = {
      exists: jest.fn(async () => true),
      read: jest.fn(async () => {
        throw new Error("EACCES");
      }),
    };

    expect(await importLegacySettings(adapter, CONFIG_DIR)).toBeNull();
  });

  it("never reads from the current plugin id", async () => {
    expect(LEGACY_PLUGIN_IDS).not.toContain("granola-oauth-sync");
  });
});
