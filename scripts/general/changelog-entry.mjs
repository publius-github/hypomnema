#!/usr/bin/env node
// Prints the body of a version's CHANGELOG.md entry (the text under
// `## <version> - <date>`, up to the next `## ` heading) and fails when
// the entry is missing or empty. The release scripts refuse to tag a
// version without one, and release.yml uses the body as the release notes.
//
// Usage: node scripts/general/changelog-entry.mjs [version] [changelog]
// (version defaults to the VERSION file, changelog to CHANGELOG.md)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const version = (process.argv[2] ?? fs.readFileSync(path.join(root, "VERSION"), "utf8")).trim();
const changelog = process.argv[3] ?? path.join(root, "CHANGELOG.md");

const lines = fs.readFileSync(changelog, "utf8").split(/\r?\n/);
const start = lines.findIndex((l) => l.startsWith(`## ${version} - `));
if (start < 0) {
  console.error(`CHANGELOG.md has no "## ${version} - <date>" entry`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
if (end < 0) end = lines.length;
const body = lines.slice(start + 1, end).join("\n").trim();
if (!body) {
  console.error(`CHANGELOG.md entry for ${version} is empty`);
  process.exit(1);
}
console.log(body);
