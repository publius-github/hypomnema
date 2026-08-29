// Markdown formatting lint shared by the editor and its tests.
// Markdown cannot really be "invalid", so the rules target the
// formatting mistakes that visibly break or degrade rendering.

export interface LintIssue {
  from: number;
  to: number;
  severity: "warning";
  message: string;
}

interface Line {
  text: string;
  from: number;
  to: number;
}

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let offset = 0;
  for (const raw of text.split("\n")) {
    lines.push({ text: raw, from: offset, to: offset + raw.length });
    offset += raw.length + 1;
  }
  return lines;
}

export function lintMarkdown(text: string): LintIssue[] {
  const issues: LintIssue[] = [];
  const lines = splitLines(text);
  let lastFence: Line | null = null;
  let openFences = 0;
  let prevText = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line.text)) {
      openFences += 1;
      lastFence = line;
      prevText = line.text;
      continue;
    }
    if (openFences % 2 === 1) {
      prevText = line.text;
      continue; // inside a code fence: anything goes
    }
    const badHeading = line.text.match(/^(#{1,6})(?=[^#\s])/);
    if (badHeading) {
      issues.push({
        from: line.from,
        to: line.from + badHeading[1].length + 1,
        severity: "warning",
        message: "Heading marker needs a space: '# Title', not '#Title'",
      });
    }
    if (/^#{1,6}\s/.test(line.text) && i > 0 && prevText.trim() !== "") {
      issues.push({
        from: line.from,
        to: line.to,
        severity: "warning",
        message: "Heading should be preceded by a blank line",
      });
    }
    const badList = line.text.match(/^(\s*)-(?=[^\s-])/);
    if (badList) {
      issues.push({
        from: line.from + badList[1].length,
        to: line.from + badList[1].length + 2,
        severity: "warning",
        message: "List marker needs a space: '- item', not '-item'",
      });
    }
    const trailing = line.text.match(/([ \t]+)$/);
    // exactly two trailing spaces are a markdown hard line break
    if (trailing && trailing[1] !== "  " && line.text.trim() !== "") {
      issues.push({
        from: line.to - trailing[1].length,
        to: line.to,
        severity: "warning",
        message:
          "Trailing whitespace (two spaces = hard break, anything else is noise)",
      });
    }
    prevText = line.text;
  }
  if (openFences % 2 === 1 && lastFence) {
    issues.push({
      from: lastFence.from,
      to: lastFence.to,
      severity: "warning",
      message: "Unclosed code fence",
    });
  }
  return issues;
}
