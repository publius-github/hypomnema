#!/usr/bin/env node
// Regenerates THIRD_PARTY_LICENSES.txt at the repo root: the license texts
// of every Rust crate and npm package that ships inside the app, which the
// MIT/Apache/BSD/... licenses require to travel with the binary. The Rust
// core compiles the file in (`include_str!`) and About shows it.
//
// Run after changing dependencies: node scripts/general/third-party-licenses.mjs
// Needs the crate sources in the cargo registry (any build or `cargo fetch`
// leaves them there) and an installed node_modules.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outFile = path.join(root, "THIRD_PARTY_LICENSES.txt");

// Gradle dependencies of the Android build: no metadata to read them from,
// so they are listed by hand. Keep in step with
// src-tauri/plugins/google-auth/android/build.gradle.kts and Tauri's own
// Android library.
const ANDROID = [
  ["androidx.appcompat:appcompat", "Apache-2.0"],
  ["androidx.core:core-ktx", "Apache-2.0"],
  ["com.google.android.material:material", "Apache-2.0"],
  ["com.fasterxml.jackson.core:jackson-databind", "Apache-2.0"],
  [
    "com.google.android.gms:play-services-auth",
    "Android Software Development Kit License (https://developer.android.com/studio/terms)",
  ],
];

const LICENSE_FILE = /^(licen[cs]e|copying|notice|copyright)([-._].*)?$/i;

/** Every license-like file at the top of a package directory, in name order. */
function licenseTexts(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => LICENSE_FILE.test(n))
    .sort()
    .flatMap((n) => {
      const p = path.join(dir, n);
      if (!fs.statSync(p).isFile()) return [];
      // Whitespace-normalized, so copies differing only in wrapping or
      // indentation collapse into one when grouped.
      const text = fs
        .readFileSync(p, "utf8")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return text ? [text] : [];
    });
}

/** Crates reachable from the app crate through normal (shipped) edges -
 * dev and build dependencies never end up in the binary. */
function rustPackages() {
  const meta = JSON.parse(
    execFileSync(
      "cargo",
      ["metadata", "--format-version", "1", "--locked"],
      { cwd: path.join(root, "src-tauri"), maxBuffer: 256 * 1024 * 1024 },
    ),
  );
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const seen = new Set();
  const stack = [meta.resolve.root];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      if (dep.dep_kinds.some((k) => k.kind === null)) stack.push(dep.pkg);
    }
  }
  return [...seen]
    .map((id) => byId.get(id))
    // Workspace and path crates are this repo's own code.
    .filter((p) => p && p.source !== null)
    .map((p) => ({
      name: p.name,
      version: p.version,
      license: p.license ?? (p.license_file ? "see license file" : "unspecified"),
      texts: licenseTexts(path.dirname(p.manifest_path)),
    }));
}

/** Production npm packages from the lockfile (the frontend bundle). */
function npmPackages() {
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  return Object.entries(lock.packages)
    .filter(([key, p]) => key.startsWith("node_modules/") && !p.dev)
    .map(([key, p]) => {
      const dir = path.join(root, key);
      let license = p.license;
      if (!license) {
        try {
          license = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).license;
        } catch {
          // fall through to "unspecified"
        }
      }
      return {
        name: key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length),
        version: p.version,
        license: license ?? "unspecified",
        texts: licenseTexts(dir),
      };
    });
}

function dedupeByIdentity(pkgs) {
  const seen = new Set();
  return pkgs.filter((p) => {
    const k = `${p.name}@${p.version}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function render(title, pkgs) {
  pkgs.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  const lines = [`${title} (${pkgs.length})`, "=".repeat(72), ""];
  for (const p of pkgs) lines.push(`  ${p.name} ${p.version} - ${p.license}`);
  lines.push("");
  // One copy of each distinct text, headed by every package that carries it.
  const groups = new Map();
  const bare = [];
  for (const p of pkgs) {
    if (p.texts.length === 0) {
      bare.push(p);
      continue;
    }
    for (const t of p.texts) {
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(`${p.name} ${p.version}`);
    }
  }
  for (const [text, owners] of groups) {
    lines.push("-".repeat(72), `Used by: ${owners.join(", ")}`, "-".repeat(72), "", text, "");
  }
  if (bare.length) {
    lines.push(
      "-".repeat(72),
      "Packages that ship no license file; their declared license applies:",
      "-".repeat(72),
      "",
    );
    for (const p of bare) lines.push(`  ${p.name} ${p.version} - ${p.license}`);
    lines.push("");
  }
  return lines.join("\n");
}

const out = [
  "Hypomnema - third-party software notices",
  "",
  "Hypomnema is free software under the GNU General Public License v3 (see",
  "LICENSE). It is built on the open-source packages listed below, each under",
  "its own license, reproduced here as those licenses require.",
  "",
  "Generated by scripts/general/third-party-licenses.mjs - do not edit by hand.",
  "",
  render("Rust crates", dedupeByIdentity(rustPackages())),
  render("JavaScript packages", dedupeByIdentity(npmPackages())),
  `Android libraries (${ANDROID.length})`,
  "=".repeat(72),
  "",
  ...ANDROID.map(([n, l]) => `  ${n} - ${l}`),
  "",
  "The Apache License 2.0 text is reproduced in the Rust crates section above.",
  "",
].join("\n");

fs.writeFileSync(outFile, out);
console.log(`Wrote ${path.relative(root, outFile)} (${Math.round(out.length / 1024)} KB)`);
