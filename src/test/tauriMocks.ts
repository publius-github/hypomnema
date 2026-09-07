import type { Mock } from "vitest";
import type { CommandHandlers } from "./fixtures";

/**
 * Routes a mocked `invoke` through a command->handler map. The vi.mock
 * calls themselves must live in each test file (they are hoisted per
 * file); this only wires the shared dispatch so a missing handler fails
 * loudly instead of resolving to undefined.
 */
export function dispatchCommands(invokeMock: Mock, handlers: CommandHandlers) {
  invokeMock.mockImplementation(async (cmd: string, args?: unknown) => {
    const handler = handlers[cmd];
    if (!handler) throw new Error(`no mock handler for command "${cmd}"`);
    return handler(args);
  });
}
