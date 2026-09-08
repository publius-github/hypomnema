// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { invokeMock, openUrlMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  openUrlMock: vi.fn<(url: string) => Promise<void>>(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: (url: string) => openUrlMock(url),
}));

import DropboxLink from "./DropboxLink";
import { dispatchCommands } from "../test/tauriMocks";

describe("DropboxLink smoke", () => {
  // Several cases in one file, and the suite doesn't run with vitest
  // globals, so RTL's automatic per-test cleanup isn't registered - two
  // renders would otherwise stack in the same document.
  afterEach(() => cleanup());

  it("walks an unlinked device through authorize, paste code, connect", async () => {
    dispatchCommands(invokeMock, {
      dropbox_status: () => ({ connected: false, expires_in_secs: 0 }),
      dropbox_auth_url: () => "https://www.dropbox.com/oauth2/authorize?x=1",
      dropbox_connect: () => ({ connected: true, expires_in_secs: 14_400 }),
    });

    render(<DropboxLink />);

    fireEvent.click(await screen.findByText("Authorize in browser"));
    // The consent page has to reach a real browser, not the webview.
    await waitFor(() =>
      expect(openUrlMock).toHaveBeenCalledWith(
        "https://www.dropbox.com/oauth2/authorize?x=1",
      ),
    );

    const input = await screen.findByLabelText(
      "Paste the code Dropbox showed you:",
    );
    fireEvent.change(input, { target: { value: " code-1 " } });
    fireEvent.click(screen.getByText("Connect"));

    // Trimmed: the code is copied off a web page, so it arrives padded.
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("dropbox_connect", {
        code: "code-1",
      }),
    );
    expect(await screen.findByText(/Access token refreshes in/)).toBeTruthy();
  });

  it("lists the app folder once linked", async () => {
    dispatchCommands(invokeMock, {
      dropbox_status: () => ({ connected: true, expires_in_secs: 600 }),
      dropbox_list_files: () => ({
        files: ["tasks.jsonl", "journal/2026-09-08.md"],
        folders: 2,
        deleted: 0,
      }),
    });

    render(<DropboxLink />);

    fireEvent.click(await screen.findByText("List app folder"));
    expect(await screen.findByText("tasks.jsonl")).toBeTruthy();
    expect(screen.getByText("journal/2026-09-08.md")).toBeTruthy();
  });

  it("surfaces a backend error instead of failing silently", async () => {
    dispatchCommands(invokeMock, {
      dropbox_status: () => ({ connected: true, expires_in_secs: 600 }),
      dropbox_list_files: () => {
        throw new Error("Dropbox API error (401): expired_access_token");
      },
    });

    render(<DropboxLink />);

    fireEvent.click(await screen.findByText("List app folder"));
    expect(await screen.findByText(/expired_access_token/)).toBeTruthy();
  });
});
