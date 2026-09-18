// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setTheme: vi.fn(async () => {}) }),
}));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => false),
  requestPermission: vi.fn(async () => "denied"),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(async () => null),
}));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  ask: vi.fn(async () => false),
}));

import Settings from "./Settings";
import { useAppStore } from "../store";
import { baseHandlers, defaultConfig } from "../test/fixtures";
import { dispatchCommands } from "../test/tauriMocks";

/** A vault is open, defaults are known, and the profile scope arrived. */
function seed(patch: Partial<typeof defaultConfig> = {}) {
  dispatchCommands(invokeMock, baseHandlers({ config_set: () => undefined }));
  useAppStore.setState({
    vaultPath: "/test/vault",
    config: { ...defaultConfig, ...patch },
    defaults: defaultConfig,
    profileKeys: [
      "theme",
      "theme_preset",
      "accent_color",
      "surface_color",
      "surface_alt_color",
      "line_color",
    ],
    profiles: [],
  });
}

describe("Settings smoke", () => {
  // several renders per file: without this the previous page stays in
  // the document and every query finds two of everything
  afterEach(cleanup);
  // jsdom has no layout, so it ships no scrollIntoView; the search jump
  // calls it on the group it lands on
  Element.prototype.scrollIntoView = vi.fn();

  it("opens on Appearance and switches to another tab", async () => {
    seed();
    render(<Settings />);

    expect(screen.getByText("Theme & palette")).toBeTruthy();
    // the per-object tabs replaced the look/geometry/behavior split
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    expect(screen.getByText("Day and list columns")).toBeTruthy();
    expect(screen.getByText("Day columns")).toBeTruthy();
    expect(screen.getByText("List columns")).toBeTruthy();
  });

  it("finds a setting on another tab and jumps to its group", async () => {
    seed();
    render(<Settings />);

    fireEvent.change(screen.getByPlaceholderText("Search settings..."), {
      target: { value: "snooze" },
    });
    const hit = await screen.findByText("Snooze length");
    fireEvent.click(hit);

    // the jump landed on the tab the hit named, with the group open
    expect(screen.getByText("Due-task notifications")).toBeTruthy();
    expect(
      screen.getByText("Snooze length of the due-task toast, minutes"),
    ).toBeTruthy();
    // and the query is cleared, so the dropdown no longer covers the page
    expect(
      (screen.getByPlaceholderText("Search settings...") as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("says so when nothing matches", () => {
    seed();
    render(<Settings />);

    fireEvent.change(screen.getByPlaceholderText("Search settings..."), {
      target: { value: "zzzz" },
    });
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
  });

  it("offers a reset only for a group that left its defaults", async () => {
    // a changed gap lives in Day columns; the shared group is untouched
    seed({ done_section_gap: 40 });
    render(<Settings />);
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));

    const resets = screen.getAllByTitle(
      "Put every field in this group back to its factory default",
    );
    expect(resets.length).toBe(1);

    fireEvent.click(resets[0]);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "config_set",
        expect.objectContaining({
          config: expect.objectContaining({
            done_section_gap: defaultConfig.done_section_gap,
          }),
        }),
      ),
    );
  });

  it("marks the groups a profile covers", () => {
    seed();
    render(<Settings />);

    // Theme & palette is fully inside the scope seeded above
    expect(screen.getByText("in profiles")).toBeTruthy();
    // and the Profiles tab lists that same group
    fireEvent.click(screen.getByRole("button", { name: "Profiles" }));
    expect(screen.getByText("A profile covers")).toBeTruthy();
    // the covered groups are folded under their tab's name, which shows
    // once per row instead of on every chip (the tab strip above has an
    // "Appearance" of its own, hence the scope)
    const scope = screen.getByText("A profile covers").parentElement;
    const row = within(scope as HTMLElement)
      .getByText("Appearance")
      .closest("div");
    expect(row?.querySelector("button")?.textContent).toBe("Theme & palette");
  });
});
