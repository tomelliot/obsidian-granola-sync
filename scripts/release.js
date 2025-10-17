#!/usr/bin/env node

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// Colors for console output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function exec(command, options = {}) {
  try {
    return execSync(command, {
      encoding: "utf8",
      stdio: "pipe",
      ...options,
    });
  } catch (error) {
    log(`Error executing command: ${command}`, colors.red);
    log(error.message, colors.red);
    process.exit(1);
  }
}

function getCurrentVersion() {
  const manifestPath = path.join(__dirname, "..", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  return manifest.version;
}

function updateManifestVersion(newVersion) {
  const manifestPath = path.join(__dirname, "..", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.version = newVersion;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  log(`Updated manifest.json version to: ${newVersion}`, colors.green);
}

function updatePackageVersion(newVersion) {
  const packagePath = path.join(__dirname, "..", "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  packageJson.version = newVersion;
  fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + "\n");
  log(`Updated package.json version to: ${newVersion}`, colors.green);
}

function bumpPatchVersion(currentVersion) {
  const [major, minor, patch] = currentVersion.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

function validateVersion(version) {
  const versionRegex = /^\d+\.\d+\.\d+$/;
  if (!versionRegex.test(version)) {
    log(
      "Invalid version format. Use semantic versioning (e.g., 1.0.0)",
      colors.red
    );
    process.exit(1);
  }
}

function checkWorkingDirectory() {
  const status = exec("git status --porcelain");
  if (status.trim()) {
    log(
      "Working directory is not clean. Please commit or stash your changes first.",
      colors.red
    );
    log("Uncommitted changes:", colors.yellow);
    log(status, colors.yellow);
    process.exit(1);
  }
}

function checkBranch() {
  const currentBranch = exec("git branch --show-current").trim();
  if (currentBranch !== "main") {
    log(
      `You are not on the main branch (current: ${currentBranch})`,
      colors.yellow
    );
    const response = require("readline-sync").question(
      "Continue anyway? (y/N): "
    );
    if (response.toLowerCase() !== "y") {
      log("Release cancelled.", colors.red);
      process.exit(1);
    }
  }
}

function runTests() {
  log("Running tests...", colors.blue);
  exec("npm test");
  log("✓ Tests passed", colors.green);
}

function buildPlugin() {
  log("Building plugin...", colors.blue);
  exec("npm run build");
  log("✓ Build completed", colors.green);
}

function commitAndTag(version) {
  const tagName = version; // Use version directly without 'v' prefix

  log(`Committing changes...`, colors.blue);
  exec(`git add manifest.json package.json`);
  exec(`git commit -m "Release ${version}"`);

  log(`Creating tag ${tagName}...`, colors.blue);
  exec(`git tag ${tagName}`);

  log(`Pushing changes and tag...`, colors.blue);
  exec(`git push origin main`);
  exec(`git push origin ${tagName}`);

  log(`✓ Successfully released ${tagName}`, colors.green);
}

function main() {
  const currentVersion = getCurrentVersion();
  let version = process.argv[2];

  // If no version specified, auto-bump patch version
  version = bumpPatchVersion(currentVersion);
  log(`🚀 Starting release process...`, colors.bright);
  if (!version) {
    log(`No version specified, auto-bumping patch version`, colors.cyan);
  }
  log(`Current version: ${currentVersion}`, colors.cyan);
  log(`New version: ${version}`, colors.cyan);

  // Validate inputs
  validateVersion(version);
  checkWorkingDirectory();
  checkBranch();

  // Update versions in both files
  updateManifestVersion(version);
  updatePackageVersion(version);

  // Run tests and build
  runTests();
  buildPlugin();

  // Confirm before pushing
  log(`\nReady to release version ${version}`, colors.bright);
  const response = require("readline-sync").question(
    "Continue with commit, tag, and push? (y/N): "
  );

  if (response.toLowerCase() !== "y") {
    log("Release cancelled. Reverting changes...", colors.yellow);
    updateManifestVersion(currentVersion);
    updatePackageVersion(currentVersion);
    process.exit(0);
  }

  // Commit and push
  commitAndTag(version);

  log(`\n🎉 Release ${version} completed!`, colors.green);
  log("The GitHub Action will now create the release draft.", colors.cyan);
}

// Check if readline-sync is available, if not provide fallback
try {
  require.resolve("readline-sync");
} catch (e) {
  log("Installing readline-sync for interactive prompts...", colors.yellow);
  exec("npm install --save-dev readline-sync");
}

main();
