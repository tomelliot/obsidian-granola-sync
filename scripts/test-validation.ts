#!/usr/bin/env node

/**
 * Test Valibot validation schemas against example API responses
 * Usage: tsx scripts/test-validation.ts [path-to-json-file]
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as v from "valibot";
import {
  GranolaApiResponseSchema,
  GranolaDocSchema,
  TranscriptResponseSchema,
} from "../src/services/validationSchemas";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Determine which file to test
const args = process.argv.slice(2);
let testFile: string;

if (args.length > 0) {
  testFile = path.resolve(process.cwd(), args[0]);
} else {
  // Default to the 100 docs response
  testFile = path.join(
    __dirname,
    "../docs/api-response/example-100-docs-response.json"
  );
}

// Check if file exists
if (!fs.existsSync(testFile)) {
  console.error(`❌ File not found: ${testFile}`);
  process.exit(1);
}

console.log(`\n🔍 Testing validation for: ${path.basename(testFile)}\n`);

// Read and parse the JSON file
let data: unknown;
try {
  const fileContent = fs.readFileSync(testFile, "utf8");
  data = JSON.parse(fileContent);
  console.log(`✅ Successfully parsed JSON file`);
} catch (error) {
  console.error(
    `❌ Error reading/parsing JSON file:`,
    error instanceof Error ? error.message : "Unknown error"
  );
  process.exit(1);
}

// Determine which schema to use based on data structure
let schema: v.GenericSchema;
let schemaName: string;

if (Array.isArray(data)) {
  schema = TranscriptResponseSchema;
  schemaName = "TranscriptResponse";
  console.log(`📋 Detected array structure - using TranscriptResponseSchema`);
  console.log(`   Array length: ${data.length}`);
} else if (
  typeof data === "object" &&
  data !== null &&
  "docs" in data &&
  Array.isArray((data as { docs: unknown }).docs)
) {
  schema = GranolaApiResponseSchema;
  schemaName = "GranolaApiResponse";
  console.log(`📋 Detected docs structure - using GranolaApiResponseSchema`);
  console.log(`   Number of docs: ${(data as { docs: unknown[] }).docs.length}`);
} else {
  console.error(`❌ Unknown data structure. Expected either:`);
  console.error(`   - Array (for transcript)`);
  console.error(`   - Object with 'docs' array (for API response)`);
  process.exit(1);
}

console.log(`\n🧪 Running ${schemaName} validation...\n`);

// Validate the data
try {
  const result = v.parse(schema, data);
  console.log(`✅ Validation PASSED!`);

  if (schemaName === "GranolaApiResponse") {
    const typedResult = result as { docs: Array<{ last_viewed_panel?: { content?: unknown } | null }> };
    console.log(`\n📊 Summary:`);
    console.log(`   - Total documents: ${typedResult.docs.length}`);
    console.log(
      `   - Documents with last_viewed_panel: ${
        typedResult.docs.filter((d) => d.last_viewed_panel).length
      }`
    );
    console.log(
      `   - Documents with content: ${
        typedResult.docs.filter((d) => d.last_viewed_panel?.content).length
      }`
    );
  } else {
    const typedResult = result as unknown[];
    console.log(`\n📊 Summary:`);
    console.log(`   - Total transcript entries: ${typedResult.length}`);
  }

  console.log(`\n✨ All data is valid!\n`);
} catch (error) {
  console.error(`❌ Validation FAILED!\n`);

  if (error && typeof error === "object" && "issues" in error) {
    const valibotError = error as { issues: Array<{
      kind?: string;
      type?: string;
      expected?: string;
      received?: string;
      message?: string;
      path?: Array<{ key?: string | number }>;
      input?: unknown;
    }> };

    console.log(`📍 Validation Issues (${valibotError.issues.length} total):\n`);

    valibotError.issues.forEach((issue, index) => {
      console.log(`Issue ${index + 1}:`);
      console.log(`  Kind: ${issue.kind || "unknown"}`);
      console.log(`  Type: ${issue.type || "unknown"}`);
      console.log(`  Expected: ${issue.expected || "unknown"}`);
      console.log(`  Received: ${issue.received || "unknown"}`);
      console.log(`  Message: ${issue.message || "unknown"}`);

      if (issue.path && issue.path.length > 0) {
        const pathStr = issue.path
          .map((p) => {
            if (typeof p.key === "number") return `[${p.key}]`;
            if (p.key) return `.${p.key}`;
            return "";
          })
          .join("");
        console.log(`  Path: ${pathStr}`);
      }

      if (issue.input !== undefined) {
        const inputStr = JSON.stringify(issue.input, null, 2);
        if (inputStr.length > 200) {
          console.log(`  Input: ${inputStr.substring(0, 200)}...`);
        } else {
          console.log(`  Input: ${inputStr}`);
        }
      }

      console.log("");
    });

    // Try to identify which document(s) are failing
    if (schemaName === "GranolaApiResponse") {
      console.log(`\n🔎 Attempting to identify problematic documents...\n`);

      const docsData = data as { docs: unknown[] };
      docsData.docs.forEach((doc, idx) => {
        try {
          v.parse(GranolaDocSchema, doc);
        } catch (docError) {
          const docObj = doc as { id?: string; title?: string };
          console.log(`❌ Document at index ${idx} failed validation:`);
          console.log(`   ID: ${docObj.id || "unknown"}`);
          console.log(`   Title: ${docObj.title || "unknown"}`);
          if (
            docError &&
            typeof docError === "object" &&
            "issues" in docError &&
            Array.isArray((docError as { issues: unknown[] }).issues) &&
            (docError as { issues: Array<{ message?: string }> }).issues.length > 0
          ) {
            console.log(
              `   Issue: ${(docError as { issues: Array<{ message?: string }> }).issues[0].message || "unknown"}`
            );
          }
          console.log("");
        }
      });
    }
  } else {
    console.error(error);
  }

  console.log(
    `\n💡 Tip: Review the validation schema in src/services/granolaApi.ts\n`
  );
  process.exit(1);
}

