#!/usr/bin/env node
// Regenerates THIRD_PARTY_LICENSES.txt at the repo root: the license texts
// of every Rust crate, npm package, prebuilt binary and Android library that
// ships inside the app, which the MIT/Apache/BSD/... licenses require to
// travel with the binary. The Rust core compiles the file in
// (`include_str!`) and About shows it. What package metadata cannot tell -
// the Android list and the licenses of bundled binaries - lives in
// scripts/general/notices/.
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

const notices = path.join(root, "scripts/general/notices");

// Gradle dependencies of the Android build: no metadata to read them from,
// so notices/android-libraries.txt lists them by hand (how to regenerate
// it is in its header).
function androidLibraries() {
  return fs
    .readFileSync(path.join(notices, "android-libraries.txt"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => l.split("\t"));
}

// Prebuilt binaries that a crate links into the app but whose license the
// crate's own metadata does not carry. Pinned to the crate version the
// text was checked against: when the crate moves, the generator stops
// until the bundled binary's license is looked at again.
const BUNDLED = [
  {
    crate: "webview2-com-sys",
    version: "0.38.2",
    what: "Microsoft WebView2 SDK 1.0.3650.58 - WebView2LoaderStatic.lib, linked into the Windows binary by webview2-com-sys",
    license: "BSD-3-Clause",
    file: "microsoft-webview2-sdk.txt",
  },
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
      authors: (p.authors ?? []).join(", "),
      repository: p.repository ?? "",
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
      let manifest = {};
      try {
        manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      } catch {
        // license falls through to "unspecified"
      }
      const author = manifest.author;
      const repository = manifest.repository;
      return {
        name: key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length),
        version: p.version,
        license: p.license ?? manifest.license ?? "unspecified",
        authors: typeof author === "object" ? (author?.name ?? "") : (author ?? ""),
        repository: typeof repository === "object" ? (repository?.url ?? "") : (repository ?? ""),
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
      "Packages that ship no license file. Their declared license applies; its",
      "standard text is reproduced above with other packages. The copyright",
      "holders are the authors the package names:",
      "-".repeat(72),
      "",
    );
    for (const p of bare) {
      lines.push(`  ${p.name} ${p.version} - ${p.license}`);
      lines.push(`    Copyright: ${p.authors || "the package's authors"}`);
      if (p.repository) lines.push(`    Source: ${p.repository}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** The bundled-binary notices, checked against the crate versions in the tree. */
function bundled(rust) {
  const lines = [`Bundled binaries (${BUNDLED.length})`, "=".repeat(72), ""];
  for (const b of BUNDLED) {
    const found = rust.filter((p) => p.name === b.crate).map((p) => p.version);
    if (!found.includes(b.version)) {
      throw new Error(
        `${b.crate} is ${found.join(", ") || "gone"}, not ${b.version}: check the license of what it bundles, ` +
          `update notices/${b.file} and BUNDLED in this script`,
      );
    }
    lines.push(`  ${b.what} - ${b.license}`);
  }
  lines.push("");
  for (const b of BUNDLED) {
    const text = fs.readFileSync(path.join(notices, b.file), "utf8").replace(/\r\n/g, "\n").trim();
    lines.push("-".repeat(72), `Used by: ${b.crate} ${b.version}`, "-".repeat(72), "", text, "");
  }
  return lines.join("\n");
}

const rust = dedupeByIdentity(rustPackages());
const android = androidLibraries();

const out = [
  "Hypomnema - third-party software notices",
  "",
  "Hypomnema is free software under the GNU General Public License v3 (see",
  "LICENSE). It is built on the open-source packages listed below, each under",
  "its own license, reproduced here as those licenses require.",
  "",
  "Generated by scripts/general/third-party-licenses.mjs - do not edit by hand.",
  "",
  render("Rust crates", rust),
  bundled(rust),
  render("JavaScript packages", dedupeByIdentity(npmPackages())),
  `Android libraries (${android.length})`,
  "=".repeat(72),
  "",
  ...android.map(([n, l]) => `  ${n} - ${l}`),
  "",
  "The Apache License 2.0 text is reproduced in the Rust crates section above.",
  "Google Play services is not open source; its terms are the Android Software",
  "Development Kit License at the address given.",
  "",
  "Brand assets",
  "=".repeat(72),
  "",
  "  The \"Sign in with Google\" button shows Google's \"G\" logo, a trademark of",
  "  Google LLC, drawn as its sign-in branding guidelines prescribe",
  "  (https://developers.google.com/identity/branding-guidelines). It is used",
  "  under those guidelines and is not covered by this program's license.",
  "",
].join("\n");

fs.writeFileSync(outFile, out);
console.log(`Wrote ${path.relative(root, outFile)} (${Math.round(out.length / 1024)} KB)`);
