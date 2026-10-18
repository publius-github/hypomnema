#!/usr/bin/env node
// Prunes stale build output from the Cargo target dir. Cargo never deletes
// anything itself: every version bump, dependency change or flag change
// compiles a unit under a new hash and leaves the old one behind, so the
// target dir grows by gigabytes a week (each `cargo test` binary alone is
// hundreds of MB). The build scripts run this before every build.
//
// Usage: node scripts/general/prune-target.mjs [--days N] [--dry-run] [--help]
//   --days N    age limit in days (default: PRUNE_DAYS or 7)
//   --dry-run   report what would go without deleting anything
// The target dir is CARGO_TARGET_DIR when set, else src-tauri/target.
//
// In every profile dir (target/<profile>, target/<triple>/<profile>) a
// compiled unit is its .fingerprint/<name>-<hash> entry plus the matching
// deps/ and build/ files. A unit is removed when none of its files changed
// within the limit and a newer unit of the same name exists - the newest
// one per name always stays, so a dependency that simply has not been
// rebuilt lately is never thrown away. Incremental caches follow the same
// rule per crate; old installers under bundle/ go by age alone (the build
// that follows writes fresh ones). A unit pruned by mistake costs only a
// recompile: Cargo rebuilds whatever output is missing.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const USAGE = "usage: node scripts/general/prune-target.mjs [--days N] [--dry-run]";
if (args.includes("--help") || args.includes("-h")) {
  console.log(USAGE);
  process.exit(0);
}
// an unknown or misspelled flag must not fall through to a real prune
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--days") i++;
  else if (args[i] !== "--dry-run") {
    console.error(`prune-target: unknown argument: ${args[i]}\n${USAGE}`);
    process.exit(1);
  }
}
const dryRun = args.includes("--dry-run");
const daysArg = args.indexOf("--days");
const days = Number(daysArg >= 0 ? args[daysArg + 1] : (process.env.PRUNE_DAYS ?? 7));
if (!Number.isFinite(days) || days < 0) {
  console.error(`prune-target: bad age limit: ${daysArg >= 0 ? args[daysArg + 1] : process.env.PRUNE_DAYS}`);
  process.exit(1);
}
const targetDir = process.env.CARGO_TARGET_DIR || path.join(root, "src-tauri", "target");
const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

const UNIT = /^(.+)-([0-9a-f]{16})$/;
const DEPS_FILE = /^(.+)-([0-9a-f]{16})(?:\..*)?$/;
const INCREMENTAL = /^(.+)-([0-9a-z]+)$/;

/** Newest mtime and total size of a file or a directory tree. */
function measure(p) {
  let st;
  try {
    st = fs.lstatSync(p);
  } catch {
    return { mtime: 0, size: 0 };
  }
  if (!st.isDirectory()) return { mtime: st.mtimeMs, size: st.size };
  let mtime = st.mtimeMs;
  let size = 0;
  for (const name of fs.readdirSync(p)) {
    const m = measure(path.join(p, name));
    mtime = Math.max(mtime, m.mtime);
    size += m.size;
  }
  return { mtime, size };
}

function list(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

let freed = 0;
let removed = 0;

function remove(paths, size) {
  for (const p of paths) {
    if (dryRun) continue;
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch (e) {
      console.warn(`prune-target: could not remove ${p}: ${e.message}`);
    }
  }
  freed += size;
  removed += 1;
}

/**
 * Removes every group older than the cutoff except the newest of each name.
 * `groups` maps a key to { name, paths }.
 */
function pruneGroups(groups) {
  const byName = new Map();
  for (const g of groups.values()) {
    let mtime = 0;
    let size = 0;
    for (const p of g.paths) {
      const m = measure(p);
      mtime = Math.max(mtime, m.mtime);
      size += m.size;
    }
    Object.assign(g, { mtime, size });
    if (!byName.has(g.name)) byName.set(g.name, []);
    byName.get(g.name).push(g);
  }
  for (const same of byName.values()) {
    same.sort((a, b) => b.mtime - a.mtime);
    for (const g of same.slice(1)) {
      if (g.mtime < cutoff) remove(g.paths, g.size);
    }
  }
}

function pruneProfile(dir) {
  // Units, keyed by hash: the fingerprint names them, deps/ and build/
  // carry the same hash (deps/ files with a lib prefix and an extension).
  const units = new Map();
  const unit = (hash, name) => {
    if (!units.has(hash)) units.set(hash, { name, paths: [] });
    return units.get(hash);
  };
  for (const entry of list(path.join(dir, ".fingerprint"))) {
    const m = UNIT.exec(entry);
    if (m) unit(m[2], m[1]).paths.push(path.join(dir, ".fingerprint", entry));
  }
  for (const sub of ["build", "deps"]) {
    for (const entry of list(path.join(dir, sub))) {
      const m = (sub === "deps" ? DEPS_FILE : UNIT).exec(entry);
      if (m) unit(m[2], m[1]).paths.push(path.join(dir, sub, entry));
    }
  }
  pruneGroups(units);

  const caches = new Map();
  for (const entry of list(path.join(dir, "incremental"))) {
    const m = INCREMENTAL.exec(entry);
    if (m) caches.set(entry, { name: m[1], paths: [path.join(dir, "incremental", entry)] });
  }
  pruneGroups(caches);

  const walkBundle = (p) => {
    for (const entry of list(p)) {
      const child = path.join(p, entry);
      const st = fs.lstatSync(child);
      if (st.isDirectory()) walkBundle(child);
      else if (st.mtimeMs < cutoff) remove([child], st.size);
    }
  };
  walkBundle(path.join(dir, "bundle"));
}

/** target/<profile> and target/<triple>/<profile>: any dir holding .fingerprint. */
function profileDirs() {
  const found = [];
  for (const a of list(targetDir)) {
    const da = path.join(targetDir, a);
    if (fs.existsSync(path.join(da, ".fingerprint"))) found.push(da);
    else if (fs.statSync(da).isDirectory()) {
      for (const b of list(da)) {
        const db = path.join(da, b);
        if (fs.existsSync(path.join(db, ".fingerprint"))) found.push(db);
      }
    }
  }
  return found;
}

if (!fs.existsSync(targetDir)) {
  console.log(`prune-target: no target dir at ${targetDir}, nothing to do`);
  process.exit(0);
}
for (const dir of profileDirs()) pruneProfile(dir);
const gb = (freed / 1024 ** 3).toFixed(2);
console.log(
  `prune-target: ${dryRun ? "would remove" : "removed"} ${removed} stale entries ` +
    `older than ${days} days (${gb} GB) from ${targetDir}`,
);
