#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");

// Parse command line arguments
const args = process.argv.slice(2);
const verbose = args.includes("--verbose") || args.includes("-v");

// Find non-flag arguments
const nonFlagArgs = args.filter(
  (arg) => !arg.startsWith("--") && !arg.startsWith("-")
);

// First non-flag arg is the type (docs or transcripts)
const type = nonFlagArgs[0];
// Second non-flag arg could be credentials path or doc ID
// Third non-flag arg would be the other one

if (!type || (type !== "docs" && type !== "transcripts")) {
  console.error("Error: First argument must be 'docs' or 'transcripts'");
  console.error(
    "Usage: node fetch-api-response.js <docs|transcripts> [docId] [credentialsPath] [--verbose]"
  );
  process.exit(1);
}

// For transcripts, doc ID is required
let docId = null;
if (type === "transcripts") {
  docId = nonFlagArgs[1];
  if (!docId) {
    console.error("Error: docId is required when fetching transcripts");
    console.error(
      "Usage: node fetch-api-response.js transcripts <docId> [credentialsPath] [--verbose]"
    );
    process.exit(1);
  }
}

// Credentials path is the last non-flag arg (or second if type is docs, third if type is transcripts)
const credentialsPathArg = type === "docs" ? nonFlagArgs[1] : nonFlagArgs[2];

const defaultPath = path.join(
  os.homedir(),
  "Library/Application Support/Granola/supabase.json"
);
const credentialsPath = credentialsPathArg
  ? path.resolve(credentialsPathArg)
  : defaultPath;

if (verbose) {
  console.log(`Reading credentials from: ${credentialsPath}`);
}

// Read and parse credentials file
let accessToken;
try {
  const credentialsData = fs.readFileSync(credentialsPath, "utf8");
  const tokenData = JSON.parse(credentialsData);
  const workosTokens = JSON.parse(tokenData.workos_tokens);
  accessToken = workosTokens.access_token;

  if (!accessToken) {
    console.error("Error: No access token found in credentials file");
    process.exit(1);
  }

  if (verbose) {
    console.log("✓ Successfully loaded access token");
  }
} catch (error) {
  console.error(`Error reading credentials file: ${error.message}`);
  process.exit(1);
}

// Make API request
async function fetchApiResponse() {
  try {
    let url, body;

    if (type === "docs") {
      url = "https://api.granola.ai/v2/get-documents";
      body = JSON.stringify({
        limit: 100,
        offset: 0,
        include_last_viewed_panel: true,
      });
    } else {
      // transcripts
      url = "https://api.granola.ai/v1/get-document-transcript";
      body = JSON.stringify({ document_id: docId });
    }

    if (verbose) {
      console.log(`\nMaking API request to ${url}...`);
      if (type === "transcripts") {
        console.log(`Document ID: ${docId}`);
      }
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "*/*",
        "User-Agent": "Undefined",
        "X-Client-Version": "1.0.0",
      },
      body: body,
    });

    if (verbose) {
      console.log(
        `\nResponse status: ${response.status} ${response.statusText}`
      );
    }

    const responseData = await response.json();

    if (verbose) {
      console.log("\n=== API Response ===");
    }
    console.log(JSON.stringify(responseData, null, 2));
  } catch (error) {
    console.error(`\nError making API request: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

fetchApiResponse();
