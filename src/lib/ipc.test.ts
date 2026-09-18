import { describe, expect, it } from "vitest";

import ipcSource from "./ipc.ts?raw";
import libSource from "../../src-tauri/src/lib.rs?raw";

// `Commands` is a type, so nothing at runtime says whether it still
// matches the Rust side. This reads both sources: the handler list in
// lib.rs is what the core registers, the keys of `Commands` are what the
// frontend may call, and the two sets must be identical.
function registeredCommands(): string[] {
  const start = libSource.indexOf("generate_handler![");
  const end = libSource.indexOf("])", start);
  return libSource
    .slice(start, end)
    .split("\n")
    .slice(1)
    .map((line) => line.trim().replace(/,$/, ""))
    .filter((line) => line.length > 0 && !line.startsWith("//"))
    .map((path) => path.split("::").pop() as string)
    .sort();
}

function typedCommands(): string[] {
  const start = ipcSource.indexOf("export interface Commands {");
  const end = ipcSource.indexOf("\n}", start);
  return ipcSource
    .slice(start, end)
    .split("\n")
    .map((line) => /^ {2}([a-z_0-9]+): \{/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined)
    .sort();
}

describe("typed invoke map", () => {
  it("names exactly the commands lib.rs registers", () => {
    expect(typedCommands()).toEqual(registeredCommands());
  });
});
