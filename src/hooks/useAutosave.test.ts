// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutosave } from "./useAutosave";

const DELAY = 800;

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(save: (item: string) => Promise<boolean | void>) {
  const onError = vi.fn();
  const hook = renderHook(() => useAutosave(save, onError, DELAY));
  return { ...hook, onError };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAutosave", () => {
  it("saves the latest text once typing pauses", async () => {
    const save = vi.fn(async () => {});
    const { result } = setup(save);

    act(() => result.current.schedule("a"));
    act(() => result.current.schedule("ab"));
    expect(result.current.saveState).toBe("dirty");
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAY);
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("ab");
    expect(result.current.saveState).toBe("saved");
    expect(result.current.savedRef.current).toBe(true);
  });

  it("stays dirty when typing went on while the save was in flight", async () => {
    const first = deferred();
    const save = vi.fn((item: string) =>
      item === "a" ? first.promise : Promise.resolve(),
    );
    const { result } = setup(save);

    act(() => result.current.schedule("a"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAY);
    });
    act(() => result.current.schedule("ab"));
    await act(async () => {
      first.resolve();
      await first.promise;
    });

    expect(result.current.saveState).toBe("dirty");
  });

  it("keeps a failed edit for the next flush and reports the error", async () => {
    let fail = true;
    const save = vi.fn(async () => {
      if (fail) throw new Error("disk full");
    });
    const { result, onError } = setup(save);

    act(() => result.current.schedule("a"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAY);
    });
    expect(result.current.saveState).toBe("failed");
    expect(onError).toHaveBeenCalledTimes(1);

    fail = false;
    await act(() => result.current.flush());

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("a");
    expect(result.current.saveState).toBe("saved");
  });

  it("leaves the editor dirty when the save refuses the edit", async () => {
    const { result } = setup(async () => false);

    act(() => result.current.schedule("broken: [yaml"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAY);
    });

    expect(result.current.saveState).toBe("dirty");
  });

  it("forgets a dropped edit, so a delete is not undone by its save", async () => {
    const save = vi.fn(async () => {});
    const { result } = setup(save);

    act(() => result.current.schedule("notes/a.md"));
    act(() => result.current.drop((item) => item === "notes/a.md"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAY);
    });

    expect(save).not.toHaveBeenCalled();
  });

  it("runs saves one at a time, in order", async () => {
    const first = deferred();
    const calls: string[] = [];
    const save = vi.fn(async (item: string) => {
      calls.push(`start ${item}`);
      if (item === "a") await first.promise;
      calls.push(`end ${item}`);
    });
    const { result } = setup(save);

    act(() => result.current.schedule("a"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAY);
    });
    act(() => result.current.schedule("ab"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAY);
    });
    expect(calls).toEqual(["start a"]);

    await act(async () => {
      first.resolve();
      await vi.runAllTimersAsync();
    });

    expect(calls).toEqual(["start a", "end a", "start ab", "end ab"]);
  });

  it("saves what is still waiting when the editor unmounts", async () => {
    const save = vi.fn(async () => {});
    const { result, unmount } = setup(save);

    act(() => result.current.schedule("tail"));
    unmount();
    await act(async () => {
      await Promise.resolve();
    });

    expect(save).toHaveBeenCalledWith("tail");
  });

  it("a loaded document is clean, and an older save landing does not change that", async () => {
    const first = deferred();
    const { result } = setup(() => first.promise);

    act(() => result.current.schedule("old doc"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DELAY);
    });
    act(() => result.current.loaded());
    act(() => result.current.schedule("new doc"));
    await act(async () => {
      first.resolve();
      await first.promise;
    });

    expect(result.current.saveState).toBe("dirty");
  });
});
