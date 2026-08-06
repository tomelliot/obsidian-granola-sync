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

/**
 * Records the new version in versions.json, which Obsidian reads to decide
 * which plugin release a given app version may install. A release missing its
 * entry here is invisible to older Obsidian versions.
 */
function updateVersionsJson(newVersion) {
  const versionsPath = path.join(__dirname, "..", "versions.json");
  const manifestPath = path.join(__dirname, "..", "manifest.json");
  const { minAppVersion } = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const versions = JSON.parse(fs.readFileSync(versionsPath, "utf8"));
  const isNewEntry = !(newVersion in versions);
  versions[newVersion] = minAppVersion;
  fs.writeFileSync(versionsPath, JSON.stringify(versions, null, 2) + "\n");
  log(
    `Updated versions.json: ${newVersion} -> minAppVersion ${minAppVersion}`,
    colors.green
  );
  return isNewEntry;
}

function removeVersionFromVersionsJson(version) {
  const versionsPath = path.join(__dirname, "..", "versions.json");
  const versions = JSON.parse(fs.readFileSync(versionsPath, "utf8"));
  delete versions[version];
  fs.writeFileSync(versionsPath, JSON.stringify(versions, null, 2) + "\n");
}

function branchExists(branch) {
  try {
    execSync(`git show-ref --verify --quiet refs/heads/${branch}`, {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function tagExists(tag) {
  try {
    execSync(`git rev-parse --verify --quiet refs/tags/${tag}`, {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
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

/**
 * Asks a yes/no question. With --yes, or when there is no terminal to prompt
 * on, falls back to `autoAnswer` instead of throwing — a release run from CI
 * or a pipe must not hang waiting on stdin.
 */
function confirm(question, { assumeYes, autoAnswer = false }) {
  if (assumeYes) {
    log(`${question} y (--yes)`, colors.cyan);
    return true;
  }
  if (!process.stdin.isTTY) {
    log(
      `${question} — no terminal to prompt on; pass --yes to confirm.`,
      colors.yellow
    );
    return autoAnswer;
  }
  const response = require("readline-sync").question(question);
  return response.toLowerCase() === "y";
}

function checkBranch(assumeYes) {
  const currentBranch = exec("git branch --show-current").trim();
  if (currentBranch !== "main") {
    log(
      `You are not on the main branch (current: ${currentBranch})`,
      colors.yellow
    );
    if (!confirm("Continue anyway? (y/N): ", { assumeYes })) {
      log("Release cancelled.", colors.red);
      process.exit(1);
    }
  }
}

function checkTagAvailable(version) {
  if (tagExists(version)) {
    log(
      `Tag ${version} already exists — that version has already been released.`,
      colors.red
    );
    log(
      `Pick a new version number, or delete the tag if the release was aborted.`,
      colors.yellow
    );
    process.exit(1);
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
  exec(`git add manifest.json package.json versions.json`);
  exec(`git commit -m "Release ${version}"`);

  log(`Creating tag ${tagName}...`, colors.blue);
  exec(`git tag ${tagName}`);

  // develop is optional — it does not exist in every clone of this repo.
  if (branchExists("develop")) {
    log(`Fast-forwarding develop branch...`, colors.blue);
    exec(`git checkout develop`);
    exec(`git merge --ff-only main`);
    exec(`git checkout main`);
    log(`✓ develop branch fast-forwarded to main`, colors.green);
  } else {
    log(`No develop branch — skipping fast-forward`, colors.cyan);
  }

  log(`Pushing changes and tag...`, colors.blue);
  exec(`git push origin main`);
  exec(`git push origin ${tagName}`);
  if (branchExists("develop")) {
    exec(`git push origin develop`);
  }

  log(`✓ Successfully released ${tagName}`, colors.green);
  log(
    `The GitHub Action will build a DRAFT release — add notes and publish it.`,
    colors.yellow
  );
}

function main() {
  const args = process.argv.slice(2);
  const assumeYes = args.includes("--yes") || args.includes("-y");
  const currentVersion = getCurrentVersion();
  let version = args.find((arg) => !arg.startsWith("-"));

  log(`🚀 Starting release process...`, colors.bright);

  // If no version specified, auto-bump patch version
  if (!version) {
    version = bumpPatchVersion(currentVersion);
    log(`No version specified, auto-bumping patch version`, colors.cyan);
  }

  log(`Current version: ${currentVersion}`, colors.cyan);
  log(`New version: ${version}`, colors.cyan);

  // Validate inputs
  validateVersion(version);
  checkTagAvailable(version);
  checkWorkingDirectory();
  checkBranch(assumeYes);

  // Update the three files that carry the version
  updateManifestVersion(version);
  updatePackageVersion(version);
  const addedVersionsEntry = updateVersionsJson(version);

  // Run tests and build
  runTests();
  buildPlugin();

  // Confirm before pushing
  log(`\nReady to release version ${version}`, colors.bright);
  if (
    !confirm("Continue with commit, tag, and push? (y/N): ", { assumeYes })
  ) {
    log("Release cancelled. Reverting changes...", colors.yellow);
    updateManifestVersion(currentVersion);
    updatePackageVersion(currentVersion);
    if (addedVersionsEntry) removeVersionFromVersionsJson(version);
    process.exit(0);
  }

  // Commit and push
  commitAndTag(version);

  log(`\n🎉 Release ${version} completed!`, colors.green);
}

// readline-sync is a devDependency, but only needed for interactive prompts —
// a --yes run must not fail (or install anything) when it is missing.
try {
  require.resolve("readline-sync");
} catch (e) {
  log(
    "readline-sync is not installed — run with --yes, or `pnpm install`.",
    colors.yellow
  );
}

main();
