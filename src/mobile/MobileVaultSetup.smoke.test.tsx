// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

import MobileVaultSetup from "./MobileVaultSetup";
import { baseHandlers } from "../test/fixtures";
import { dispatchCommands } from "../test/tauriMocks";

const signedIn = {
  available: true,
  signed_in: true,
  email: "a@example.com",
  name: "A",
};

function called(cmd: string): boolean {
  return invokeMock.mock.calls.some(([name]) => name === cmd);
}

describe("MobileVaultSetup smoke", () => {
  afterEach(() => {
    cleanup();
    invokeMock.mockReset();
  });

  it("signing in pulls the vault Drive already holds", async () => {
    dispatchCommands(
      invokeMock,
      baseHandlers({
        vault_local_path: () => "/local/vault",
        google_sign_in: () => signedIn,
        google_pull_vault: () => ({ files: 12, failed: [] }),
      }),
    );
    render(<MobileVaultSetup />);

    fireEvent.click(await screen.findByText("Sign in with Google"));
    await waitFor(() => expect(called("google_pull_vault")).toBe(true));
    await waitFor(() => expect(called("vault_status")).toBe(true));
    expect(called("vault_use_local")).toBe(false);
  });

  it("with nothing in Drive, starts a local vault and uploads it", async () => {
    dispatchCommands(
      invokeMock,
      baseHandlers({
        vault_local_path: () => "/local/vault",
        google_sign_in: () => signedIn,
        google_pull_vault: () => null,
        vault_use_local: () => "/local/vault",
        sync_now: () => ({}),
      }),
    );
    render(<MobileVaultSetup />);

    fireEvent.click(await screen.findByText("Sign in with Google"));
    await waitFor(() => expect(called("vault_use_local")).toBe(true));
    await waitFor(() => expect(called("sync_now")).toBe(true));
  });
});
