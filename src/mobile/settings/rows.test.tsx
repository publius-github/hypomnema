// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChoiceRow, NumberRow, SwitchRow } from "./rows";

describe("settings rows", () => {
  it("a switch row toggles from anywhere on the row", () => {
    const onChange = vi.fn();
    render(
      <SwitchRow label="Weekday markers" hint="hint" checked onChange={onChange} />,
    );
    fireEvent.click(screen.getByText("hint"));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("a choice applies on tap and closes its sheet", () => {
    const onChange = vi.fn();
    render(
      <ChoiceRow
        label="Done tasks"
        value="inline"
        options={[
          { value: "inline", label: "In place" },
          { value: "separate", label: "Own sections" },
        ]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("In place"));
    fireEvent.click(screen.getByRole("radio", { name: "Own sections" }));
    expect(onChange).toHaveBeenCalledWith("separate");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("picking the current choice again writes nothing", () => {
    const onChange = vi.fn();
    render(
      <ChoiceRow
        label="Theme"
        value="dark"
        options={[
          { value: "dark", label: "Dark" },
          { value: "light", label: "Light" },
        ]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("Dark"));
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("a custom number outside its range cannot be set", () => {
    const onChange = vi.fn();
    render(
      <NumberRow
        label="Catch up"
        value={14}
        presets={[7, 14]}
        min={1}
        max={365}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("14"));
    fireEvent.click(screen.getByRole("radio", { name: /Custom/ }));
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "400" } });
    expect(screen.getByRole("button", { name: "Set" })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.change(input, { target: { value: "21" } });
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    expect(onChange).toHaveBeenCalledWith(21);
  });
});
