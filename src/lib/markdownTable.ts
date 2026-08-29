// Markdown table formatting shared by the editor's Tab handler and its
// tests. Widths are counted in Unicode code points, not UTF-16 units,
// so non-BMP characters do not skew the padding.

const width = (s: string) => [...s].length;

const pad = (s: string, target: number, fill = " ") =>
  s + fill.repeat(Math.max(0, target - width(s)));

export const isTableLine = (text: string) => /^\s*\|/.test(text);

export const isSeparatorCells = (cells: string[]) =>
  cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));

/** "| a | b |" -> ["a", "b"]; leading/trailing pipes are optional. */
export function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((c) => c.trim());
}

/**
 * Reformats one contiguous table block: every column padded to its
 * widest cell across ALL rows, separator rows rebuilt keeping their
 * alignment colons. Input and output are full lines.
 */
export function formatTableBlock(lines: string[]): string[] {
  const rows = lines.map(splitRow);
  const columns = Math.max(...rows.map((r) => r.length));
  const widths = Array.from({ length: columns }, (_, col) =>
    Math.max(
      3,
      ...rows
        .filter((r) => !isSeparatorCells(r))
        .map((r) => width(r[col] ?? "")),
    ),
  );
  return rows.map((cells) => {
    const padded = Array.from({ length: columns }, (_, col) => {
      const cell = cells[col] ?? "";
      if (isSeparatorCells(cells)) {
        const left = cell.startsWith(":");
        const right = cell.endsWith(":");
        const dashes = "-".repeat(
          Math.max(1, widths[col] - (left ? 1 : 0) - (right ? 1 : 0)),
        );
        return pad(
          `${left ? ":" : ""}${dashes}${right ? ":" : ""}`,
          widths[col],
          "-",
        );
      }
      return pad(cell, widths[col]);
    });
    return `| ${padded.join(" | ")} |`;
  });
}
