#!/usr/bin/env node
// Exits 0 when node_modules matches package-lock.json, so a build script can
// skip `npm ci` (which deletes and reinstalls everything). npm ci writes
// node_modules/.package-lock.json: the packages it actually installed.
// Compared entry by entry, not by file date - bump.sh rewrites the app's own
// version in package-lock.json on every bump, which changes no dependency.
// Optional packages the lockfile has and node_modules lacks are fine: npm
// installs only the current OS's native binaries. Whether those are this
// OS's is the caller's check (the build scripts look for the tauri CLI's @tauri-apps/cli-<platform>).
//
// Usage: node scripts/general/node-modules-current.mjs
// Prints why when node_modules is stale and exits 1.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function packages(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), "utf8")).packages ?? {};
  } catch {
    return null;
  }
}

function stale(reason) {
  console.log(reason);
  process.exit(1);
}

const wanted = packages("package-lock.json");
const installed = packages("node_modules/.package-lock.json");
if (!wanted) stale("package-lock.json is missing or unreadable");
if (!installed) stale("node_modules is missing or incomplete");

for (const [key, entry] of Object.entries(wanted)) {
  if (key === "") continue; // the app itself
  const have = installed[key];
  if (!have) {
    if (entry.optional) continue;
    stale(`${key} is not installed`);
  }
  for (const field of ["version", "resolved", "integrity", "link"]) {
    if (entry[field] !== have[field]) stale(`${key} differs from package-lock.json (${field})`);
  }
}
for (const key of Object.keys(installed)) {
  if (!wanted[key]) stale(`${key} is installed but no longer in package-lock.json`);
}
