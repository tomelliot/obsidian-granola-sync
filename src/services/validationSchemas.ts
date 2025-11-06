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
  created_at: v.optional(v.string()),
  updated_at: v.optional(v.string()),
  attendees: v.optional(v.array(v.string())),
  people: v.optional(
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
  folder: v.optional(v.nullish(v.string())),
  folder_path: v.optional(v.nullish(v.string())),
  collection: v.optional(v.nullish(v.string())),
  workspace: v.optional(v.nullish(v.string())),
  last_viewed_panel: v.nullish(
    v.object({
      // Content can be either a ProseMirrorDoc object or an HTML string
      content: v.nullish(v.union([ProseMirrorDocSchema, v.string()])),
    })
  ),
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

