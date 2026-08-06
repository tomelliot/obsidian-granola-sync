import { listAllFolders } from "./granolaApi";
import type { GranolaDoc } from "./granolaApi";
import { log } from "../utils/logger";

/**
 * Metadata for a single folder, used for hierarchy resolution and rename detection.
 */
export interface FolderInfo {
  title: string;
  parentId: string | null;
}

/**
 * Persisted folder map data. Stored in plugin data.json across reloads.
 */
export interface FolderMapData {
  /** Folder ID → folder metadata (for detecting renames/moves) */
  folders: Record<string, FolderInfo>;
  /** Document ID → array of full folder path strings */
  docFolders: Record<string, string[]>;
  /** Timestamp of when this map was last built */
  lastUpdated: number;
}

/**
 * Result of comparing a fresh folder map against a previously persisted one.
 */
export interface FolderMapDiff {
  /** Map of old full path → new full path for all renamed/moved folders */
  renamedPaths: Map<string, string>;
}

/**
 * Resolves the full path for a folder by walking up the parent chain.
 * e.g. "Good2Go" with parent "Clients" → "Clients/Good2Go"
 */
export function resolveFolderPath(
  folderId: string,
  folders: Record<string, FolderInfo>
): string {
  const parts: string[] = [];
  let currentId: string | null = folderId;

  // Walk up the parent chain, guarding against circular references
  const visited = new Set<string>();
  while (currentId && folders[currentId]) {
    if (visited.has(currentId)) {
      log.error(`Circular folder hierarchy detected at folder ${currentId}`);
      break;
    }
    visited.add(currentId);
    parts.unshift(folders[currentId].title);
    currentId = folders[currentId].parentId;
  }

  return parts.join("/");
}

/**
 * Builds a fresh FolderMapData from the v1 folders list and each note's
 * folder membership (notes carry their folder IDs inline, so no per-folder
 * membership fetch is needed).
 */
export async function buildFolderMap(
  apiKey: string,
  docs: GranolaDoc[]
): Promise<FolderMapData> {
  const folderList = await listAllFolders(apiKey);

  const folders: Record<string, FolderInfo> = {};
  for (const folder of folderList) {
    folders[folder.id] = {
      title: folder.name,
      parentId: folder.parent_folder_id ?? null,
    };
  }

  log.debug(`buildFolderMap — found ${Object.keys(folders).length} folder(s)`);

  const docFolders: Record<string, string[]> = {};
  for (const doc of docs) {
    for (const folderId of doc.folder_ids ?? []) {
      const folderPath = resolveFolderPath(folderId, folders);
      if (!folderPath) continue;
      (docFolders[doc.id] ??= []).push(folderPath);
    }
  }

  const docCount = Object.keys(docFolders).length;
  log.debug(`buildFolderMap — ${docCount} document(s) mapped to folders`);

  return {
    folders,
    docFolders,
    lastUpdated: Date.now(),
  };
}

/**
 * Compares a fresh folder map against a previously persisted one to detect
 * folder renames and moves. Returns a map of old paths to new paths.
 */
export function diffFolderMaps(
  previous: FolderMapData | null,
  current: FolderMapData
): FolderMapDiff {
  const renamedPaths = new Map<string, string>();

  if (!previous) {
    return { renamedPaths };
  }

  // Check each folder that exists in both old and new maps
  for (const folderId of Object.keys(current.folders)) {
    const oldFolder = previous.folders[folderId];
    if (!oldFolder) {
      continue; // New folder, no rename to detect
    }

    const newFolder = current.folders[folderId];
    const titleChanged = oldFolder.title !== newFolder.title;
    const parentChanged = oldFolder.parentId !== newFolder.parentId;

    if (titleChanged || parentChanged) {
      const oldPath = resolveFolderPath(folderId, previous.folders);
      const newPath = resolveFolderPath(folderId, current.folders);
      if (oldPath !== newPath) {
        renamedPaths.set(oldPath, newPath);
      }
    }
  }

  // A parent rename affects all children's resolved paths, even if the child
  // folder itself didn't change. Check for any folder whose resolved path
  // differs between old and new maps.
  for (const folderId of Object.keys(current.folders)) {
    if (!previous.folders[folderId]) continue;

    const oldPath = resolveFolderPath(folderId, previous.folders);
    const newPath = resolveFolderPath(folderId, current.folders);
    if (oldPath !== newPath && !renamedPaths.has(oldPath)) {
      renamedPaths.set(oldPath, newPath);
    }
  }

  return { renamedPaths };
}
