import * as v from "valibot";
import {
  TranscriptEntrySchema,
  DocumentListMetadataEntrySchema,
  DocumentListWithDocsResponseSchema,
  DocumentSetResponseSchema,
} from "./validationSchemas";

// ProseMirror types (defined explicitly due to recursive nature)
export interface ProseMirrorNode {
  type: string;
  content?: ProseMirrorNode[];
  text?: string;
  attrs?: { [key: string]: unknown };
}

export interface ProseMirrorDoc {
  type: "doc";
  content: ProseMirrorNode[];
}

// GranolaDoc type (defined explicitly due to recursive nature of ProseMirrorDoc)
export interface GranolaAttachment {
  id: string;
  url: string;
  type?: string;
  width?: number;
  height?: number;
  // Allow additional metadata fields without forcing callers to model them
  // explicitly. This keeps the type aligned with the API while remaining
  // forward-compatible.
  [key: string]: unknown;
}

export interface GranolaDoc {
  id: string;
  title: string | null;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
  attendees?: string[];
  people?: {
    attendees?: Array<{
      name?: string;
      email?: string;
    }>;
  };
  last_viewed_panel?: {
    content?: ProseMirrorDoc | string | null;
  } | null;
  notes_markdown?: string;
  // Optional attachments array as returned by the Granola API. May be null when
  // the doc has no attachments. Used primarily for image attachments synced
  // into the Obsidian vault and embedded at the end of the note.
  attachments?: GranolaAttachment[] | null;
}

// Infer TypeScript types from validation schemas
export type TranscriptEntry = v.InferOutput<typeof TranscriptEntrySchema>;

// Document list (folder) types
export type DocumentListMetadata = v.InferOutput<
  typeof DocumentListMetadataEntrySchema
>;

export type DocumentListWithDocs = v.InferOutput<
  typeof DocumentListWithDocsResponseSchema
>;

// Document set entry as returned by get-document-set
export type DocumentSetEntry = {
  updated_at: string;
  owner?: true;
  shared?: true;
};

export type DocumentSet = v.InferOutput<typeof DocumentSetResponseSchema>;
