// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { openUrlMock } = vi.hoisted(() => ({ openUrlMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => false) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));

import ProblemReport from "./ProblemReport";

describe("ProblemReport", () => {
  afterEach(() => openUrlMock.mockReset());

  it("opens the donation page from Support us", async () => {
    render(<ProblemReport version="1.2.3" donateUrl="https://ko-fi.com/example" />);
    fireEvent.click(screen.getByRole("button", { name: "Support us" }));
    expect(openUrlMock).toHaveBeenCalledWith("https://ko-fi.com/example");
  });

  it("has no Support us link without a donation url, as on the crash screen", () => {
    render(<ProblemReport version="1.2.3" />);
    expect(screen.queryByRole("button", { name: "Support us" })).toBeNull();
    expect(screen.getByRole("button", { name: "Report a problem" })).toBeTruthy();
  });
});
