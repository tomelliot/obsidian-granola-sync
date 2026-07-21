import * as v from "valibot";
import {
  TranscriptEntrySchema,
  FolderSchema,
  NoteSummarySchema,
  NoteDetailSchema,
} from "./validationSchemas";

export type TranscriptEntry = v.InferOutput<typeof TranscriptEntrySchema>;
export type GranolaFolder = v.InferOutput<typeof FolderSchema>;
export type NoteSummaryV1 = v.InferOutput<typeof NoteSummarySchema>;
export type NoteDetailV1 = v.InferOutput<typeof NoteDetailSchema>;

/**
 * Internal domain shape consumed by the sync pipeline (processor, file sync,
 * daily notes, path resolution). Built from a v1 NoteDetail by
 * noteDetailToGranolaDoc() in granolaApi.ts.
 */
export interface GranolaDoc {
  id: string;
  title: string | null;
  created_at?: string;
  updated_at?: string;
  /** Granola web app URL; its trailing UUID is the legacy internal doc id. */
  web_url?: string;
  people?: {
    attendees?: Array<{ name?: string; email?: string }>;
  };
  summary_markdown?: string | null;
  summary_text?: string;
  /** IDs of folders this note belongs to (fol_…). */
  folder_ids?: string[];
  /** Present when fetched with include=transcript. */
  transcript?: TranscriptEntry[] | null;
}
