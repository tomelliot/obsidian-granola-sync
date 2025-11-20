import * as v from "valibot";

// Define a schema with a required key
const TestSchema = v.object({
  id: v.string(),
  name: v.string(),
  email: v.optional(v.string()),
});

// Test data: missing required 'name' key
const invalidData = {
  id: "123",
  // name is missing!
};

console.log("=== Testing valibot safeParse with missing required key ===\n");
console.log("Schema:");
console.log("- id: string (required)");
console.log("- name: string (required)");
console.log("- email: string (optional)");
console.log("\nTest data:");
console.log(JSON.stringify(invalidData, null, 2));

const result = v.safeParse(TestSchema, invalidData);

console.log("\n=== safeParse result ===");
console.log("success:", result.success);

if (!result.success) {
  console.log("\n=== Issues details ===");
  console.log(`Total issues: ${result.issues.length}\n`);

  result.issues.forEach((issue, index) => {
    console.log(`Issue ${index + 1}:`);
    console.log("  - type:", issue.type);
    console.log("  - input:", issue.input);
    console.log("  - expected:", issue.expected);
    console.log("  - received:", issue.received);
    console.log("  - message:", issue.message);

    // Path information
    if (issue.path) {
      console.log("  - path:");
      issue.path.forEach((pathItem, pathIndex) => {
        console.log(`      [${pathIndex}] type: ${pathItem.type}`);
        console.log(`            origin: ${pathItem.origin}`);
        console.log(`            input: ${JSON.stringify(pathItem.input)}`);
        if ("key" in pathItem) {
          console.log(`            key: ${pathItem.key}`);
        }
        if ("value" in pathItem) {
          console.log(`            value: ${JSON.stringify(pathItem.value)}`);
        }
      });
    }

    // Additional issue-specific fields
    if ("requirement" in issue) {
      console.log("  - requirement:", issue.requirement);
    }
    if ("kind" in issue) {
      console.log("  - kind:", issue.kind);
    }

    // Full issue object for inspection
    console.log("\n  - Full issue object:");
    console.log(JSON.stringify(issue, null, 4));
    console.log("\n" + "=".repeat(50) + "\n");
  });

  // Summary
  console.log("\n=== Summary ===");
  console.log("All issues as JSON:");
  console.log(JSON.stringify(result.issues, null, 2));
} else {
  console.log("\nParse succeeded (unexpected!)");
  console.log("Output:", JSON.stringify(result.output, null, 2));
}
