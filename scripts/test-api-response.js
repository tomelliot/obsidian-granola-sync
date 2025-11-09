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

// Parse --output or -o flag for output file
let outputFile = null;
const outputIndex = args.findIndex((arg) => arg === "--output" || arg === "-o");
if (outputIndex !== -1 && args[outputIndex + 1]) {
  outputFile = args[outputIndex + 1];
}

// Parse --body or -b flag for body JSON
let bodyJson = null;
const bodyIndex = args.findIndex((arg) => arg === "--body" || arg === "-b");
if (bodyIndex !== -1 && args[bodyIndex + 1]) {
  bodyJson = args[bodyIndex + 1];
}

const defaultPath = path.join(
  os.homedir(),
  "Library/Application Support/Granola/supabase.json"
);
const credentialsPath = defaultPath;

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
    const url = "https://api.granola.ai/v2/get-documents";

    // Build body - merge default with CLI-provided body
    const defaultBody = {
      limit: 3,
      include_last_viewed_panel: true,
    };

    let body;
    if (bodyJson) {
      try {
        const cliBody = JSON.parse(bodyJson);
        body = JSON.stringify({ ...defaultBody, ...cliBody });
        if (verbose) {
          console.log("Using body:", body);
        }
      } catch (error) {
        console.error(`Error parsing --body JSON: ${error.message}`);
        process.exit(1);
      }
    } else {
      body = JSON.stringify(defaultBody);
    }

    if (verbose) {
      console.log(`\nMaking API request to ${url}...`);
      console.log(`Request body: ${body}`);
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

    // Save to file if output file specified
    if (outputFile) {
      const outputPath = path.resolve(outputFile);
      fs.writeFileSync(outputPath, JSON.stringify(responseData, null, 2));
      console.log(`\n✓ Response saved to: ${outputPath}`);
    } else {
      console.log(JSON.stringify(responseData, null, 2));
    }
  } catch (error) {
    console.error(`\nError making API request: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

fetchApiResponse();
