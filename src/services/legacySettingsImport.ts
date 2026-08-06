/**
 * Settings import from plugin folders this plugin used to live in.
 *
 * The plugin id is the vault folder name (`.obsidian/plugins/<id>/`), so every
 * id change strands the previous folder's `data.json`. Worse, the id
 * `granola-api-sync` collides with an unrelated community-store plugin of the
 * same id, so that folder may now belong to *that* plugin — we validate the
 * shape of anything we read before adopting it.
 */

/** Minimal surface of Obsidian's DataAdapter that we need. */
export interface DataAdapterLike {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
}

/**
 * Plugin ids this plugin has shipped under, newest first.
 *
 * - `granola-api-sync` — used 0.1.0–0.1.2. Abandoned because the Obsidian
 *   community store already registers that id for `arshiaecho/obsidian-granola-api-sync`,
 *   which made Obsidian's updater overwrite this plugin with that one.
 * - `granola-sync` — the upstream plugin this one was forked from.
 */
export const LEGACY_PLUGIN_IDS = ["granola-api-sync", "granola-sync"];

/**
 * Setting keys distinctive to this plugin's schema. Used to tell our own
 * `data.json` apart from a same-named plugin's, since both can occupy
 * `.obsidian/plugins/granola-api-sync/`.
 */
const SCHEMA_MARKERS = [
  "saveAsIndividualFiles",
  "syncDestination",
  "transcriptHandling",
  "subfolderPattern",
  "filenamePattern",
  "dailyNoteSectionHeading",
  "dailyNoteLinkHeading",
  "linkFromDailyNotes",
  "titleFilterMode",
  "transcriptFilenamePattern",
  "_folderMapCache",
];

/** How many markers must be present before we trust the data is ours. */
const REQUIRED_MARKER_COUNT = 2;

export interface LegacySettingsImport {
  /** The plugin id the settings were read from. */
  pluginId: string;
  /** Raw settings object, to be merged over DEFAULT_SETTINGS by the caller. */
  settings: Record<string, unknown>;
}

/**
 * True when a parsed `data.json` carries enough of this plugin's distinctive
 * keys to be confidently ours rather than a different plugin sharing the id.
 */
export function looksLikeGranolaSyncSettings(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value as Record<string, unknown>);
  const matches = SCHEMA_MARKERS.filter((marker) => keys.includes(marker));
  return matches.length >= REQUIRED_MARKER_COUNT;
}

/**
 * True when this plugin has no settings of its own yet — Obsidian returns
 * `null` from `loadData()` when `data.json` is absent, and an empty object if
 * the file exists but holds nothing.
 */
export function hasNoExistingSettings(loaded: unknown): boolean {
  if (loaded === null || loaded === undefined) return true;
  if (typeof loaded !== "object" || Array.isArray(loaded)) return false;
  return Object.keys(loaded as Record<string, unknown>).length === 0;
}

/**
 * Looks for settings left behind in a previous plugin folder and returns the
 * first set that is recognisably ours. Returns `null` when there is nothing to
 * import, when the folder belongs to a different plugin, or when the file is
 * unreadable — importing is best-effort and must never block plugin load.
 */
export async function importLegacySettings(
  adapter: DataAdapterLike,
  configDir: string
): Promise<LegacySettingsImport | null> {
  for (const pluginId of LEGACY_PLUGIN_IDS) {
    const dataPath = `${configDir}/plugins/${pluginId}/data.json`;
    let parsed: unknown;
    try {
      if (!(await adapter.exists(dataPath))) continue;
      parsed = JSON.parse(await adapter.read(dataPath));
    } catch {
      // Missing, unreadable, or malformed — try the next candidate.
      continue;
    }
    if (!looksLikeGranolaSyncSettings(parsed)) continue;
    return { pluginId, settings: parsed as Record<string, unknown> };
  }
  return null;
}
