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

// Task definition schema - name can be null
// Using looseObject to allow any additional fields from API
const TaskDefinitionSchema = v.looseObject({
  name: v.nullish(v.string()),
});

// Task schema
// Using looseObject to allow any additional fields from API
const TaskSchema = v.looseObject({
  task_definitions: v.optional(v.array(TaskDefinitionSchema)),
});

// Using looseObject to allow any additional fields from API
export const GranolaDocSchema = v.looseObject({
  id: v.string(),
  title: v.nullish(v.string()),
  created_at: v.nullish(v.string()),
  updated_at: v.nullish(v.string()),
  people: v.nullish(
    v.looseObject({
      attendees: v.optional(
        v.array(
          v.looseObject({
            name: v.optional(v.string()),
            email: v.optional(v.string()),
          })
        )
      ),
    })
  ),
  last_viewed_panel: v.nullish(
    v.looseObject({
      // Content can be either a ProseMirrorDoc object or an HTML string
      content: v.nullish(v.union([ProseMirrorDocSchema, v.string()])),
    })
  ),
  // Add tasks field to handle the new API structure
  tasks: v.nullish(v.array(TaskSchema)),
});

// Using looseObject to allow any additional fields from API
export const GranolaApiResponseSchema = v.looseObject({
  // Support both 'docs' and 'data' field names for API compatibility
  docs: v.optional(v.array(GranolaDocSchema)),
  data: v.optional(v.array(GranolaDocSchema)),
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

