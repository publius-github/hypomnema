import { Fragment, type ComponentProps } from "react";
import { LIST_GAP_STRIPES } from "../lib/tasks";
import type { ColumnSection } from "../hooks/useColumnSections";
import GapFill from "../components/GapFill";
import SectionPlate from "../components/SectionPlate";
import TaskRow from "./TaskRow";

type RowExtras = Omit<
  ComponentProps<typeof TaskRow>,
  "task" | "blockIndex" | "lineAbove"
>;

/**
 * A desktop column's sections as phone rows: the same plates, separator
 * stripes and block hairlines (`useDaySections` / `useListSections`),
 * over the column's card fill. `extras` adds per-row props the screen
 * owns - a list's Up/Down neighbours, its hidden list chip.
 */
export default function Sections({
  sections,
  extras,
}: {
  sections: ColumnSection[];
  extras?: (section: ColumnSection, index: number) => RowExtras;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-surface-alt px-2 pb-2">
      {sections.map((section) => (
        <section key={section.key} className="flex flex-col">
          <SectionPlate section={section} />
          <ul>
            {section.rows.map((row, i) => (
              <Fragment key={row.task.id}>
                {row.gapBefore && (
                  <li aria-hidden>
                    <GapFill stripes={LIST_GAP_STRIPES.category} />
                  </li>
                )}
                <TaskRow
                  task={row.task}
                  blockIndex={row.blockIndex}
                  lineAbove={row.lineAbove}
                  {...extras?.(section, i)}
                />
              </Fragment>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
