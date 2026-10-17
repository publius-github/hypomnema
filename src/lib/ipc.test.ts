import { describe, expect, it } from "vitest";

import ipcSource from "./ipc.ts?raw";
import libSource from "../../src-tauri/src/lib.rs?raw";

const rustSources = import.meta.glob<string>("../../src-tauri/src/*.rs", {
  query: "?raw",
  import: "default",
  eager: true,
});

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

// Tauri hands a command its arguments by name (camelCase on this side),
// so a parameter renamed in Rust but not in `Commands` still typechecks
// and only fails in the running app. Parameters the runtime injects
// (State, AppHandle, a window) are not the caller's to send.
const INJECTED = /^(tauri::)?(State|AppHandle|Window|WebviewWindow)\b/;

function camel(name: string): string {
  return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function rustArgs(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const command =
    /#\[tauri::command[^\]]*\]\s*(?:pub(?:\(crate\))? )?(?:async )?fn (\w+)(?:<[^>]*>)?\(([^)]*)\)/g;
  for (const source of Object.values(rustSources)) {
    for (const [, name, params] of source.matchAll(command)) {
      out[name] = params
        .split(/,(?![^<]*>)/)
        .map((param) => param.trim())
        .filter(Boolean)
        .map((param) => {
          const colon = param.indexOf(":");
          return [param.slice(0, colon).replace(/^mut /, "").trim(), param.slice(colon + 1).trim()];
        })
        .filter(([, type]) => !INJECTED.test(type))
        .map(([arg]) => camel(arg.replace(/^_/, "")))
        .sort();
    }
  }
  return out;
}

function typedArgs(): Record<string, string[]> {
  const start = ipcSource.indexOf("export interface Commands {");
  const block = ipcSource.slice(start, ipcSource.indexOf("\n}", start));
  const out: Record<string, string[]> = {};
  const entry = /^ {2}([a-z_0-9]+): \{([\s\S]*?)(?=^ {2}[a-z_0-9]+: \{|(?![\s\S]))/gm;
  for (const [, name, body] of block.matchAll(entry)) {
    const args = /args:\s*(void|\{([\s\S]*?)\})\s*;\s*result/.exec(body);
    if (!args) continue;
    out[name] =
      args[1] === "void" ? [] : [...new Set([...args[2].matchAll(/(\w+)\??:/g)].map((m) => m[1]))].sort();
  }
  return out;
}

describe("typed invoke map", () => {
  it("names exactly the commands lib.rs registers", () => {
    expect(typedCommands()).toEqual(registeredCommands());
  });

  it("passes every command the arguments its Rust function takes", () => {
    const rust = rustArgs();
    const typed = typedArgs();
    expect(Object.keys(rust).sort()).toEqual(registeredCommands());
    expect(typed).toEqual(rust);
  });
});
