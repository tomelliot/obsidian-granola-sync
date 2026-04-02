import * as v from "valibot";

// ProseMirror validation schemas
export const ProseMirrorNodeSchema: v.GenericSchema = v.lazy(() =>
  v.object({
    type: v.string(),
    content: v.optional(v.array(ProseMirrorNodeSchema)),
    text: v.optional(v.string()),
    attrs: v.optional(v.record(v.string(), v.unknown())),
  })
);

export const ProseMirrorDocSchema = v.object({
  type: v.literal("doc"),
  content: v.array(ProseMirrorNodeSchema),
});

// Granola API validation schemas
export const GranolaDocSchema = v.object({
  id: v.string(),
  title: v.nullish(v.string()),
  created_at: v.nullish(v.string()),
  updated_at: v.nullish(v.string()),
  // API may return null for docs with no attachments; optional allows key to be absent
  attachments: v.optional(
    v.nullish(
      v.array(
        v.object({
          id: v.string(),
          url: v.string(),
          type: v.optional(v.string()),
          width: v.optional(v.number()),
          height: v.optional(v.number()),
        })
      )
    )
  ),
  people: v.nullish(
    v.object({
      attendees: v.optional(
        v.array(
          v.object({
            name: v.optional(v.string()),
            email: v.optional(v.string()),
          })
        )
      ),
    })
  ),
  last_viewed_panel: v.nullish(
    v.object({
      // Content can be either a ProseMirrorDoc object or an HTML string
      content: v.nullish(v.union([ProseMirrorDocSchema, v.string()])),
    })
  ),
  notes_markdown: v.nullish(v.string()),
});

export const GranolaApiResponseSchema = v.object({
  docs: v.array(GranolaDocSchema),
});

export const TranscriptEntrySchema = v.object({
  document_id: v.string(),
  start_timestamp: v.string(),
  text: v.string(),
  source: v.string(),
  id: v.string(),
  is_final: v.boolean(),
  end_timestamp: v.string(),
});

export const TranscriptResponseSchema = v.array(TranscriptEntrySchema);

// Document list (folder) validation schemas
export const DocumentListMetadataEntrySchema = v.object({
  id: v.string(),
  title: v.string(),
  parent_document_list_id: v.nullish(v.string()),
  created_at: v.nullish(v.string()),
  updated_at: v.nullish(v.string()),
  is_default_folder: v.optional(v.boolean()),
  sort_order: v.optional(v.number()),
});

export const DocumentListsMetadataResponseSchema = v.object({
  lists: v.record(v.string(), DocumentListMetadataEntrySchema),
});

// Document set (get-document-set) validation schemas
const DocumentSetEntrySchema = v.object({
  updated_at: v.string(),
  owner: v.optional(v.literal(true)),
  shared: v.optional(v.literal(true)),
  has_shareable_link: v.optional(v.boolean()),
});

export const DocumentSetResponseSchema = v.object({
  documents: v.record(v.string(), DocumentSetEntrySchema),
});

// Batch document fetch (get-documents-batch) — returns same shape as get-documents
export const DocumentsBatchResponseSchema = v.object({
  docs: v.array(GranolaDocSchema),
});

// For get-document-list response, we only need document IDs from the documents array
const DocumentListDocRefSchema = v.object({
  id: v.string(),
});

export const DocumentListWithDocsResponseSchema = v.object({
  id: v.string(),
  title: v.string(),
  parent_document_list_id: v.nullish(v.string()),
  documents: v.optional(v.array(DocumentListDocRefSchema), []),
});
