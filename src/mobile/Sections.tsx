import { Fragment, type ComponentProps } from "react";
import type { ColumnSection } from "../hooks/useColumnSections";
import SectionBlock, {
  labelInHeader,
  RowLead,
} from "../components/ColumnSection";
import { useAppStore } from "../store";
import TaskRow from "./TaskRow";

type RowExtras = Omit<
  ComponentProps<typeof TaskRow>,
  "task" | "blockIndex" | "lineAbove" | "labelInHeader"
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
  const config = useAppStore((s) => s.config);
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-surface-alt px-2 pb-2">
      {sections.map((section) => (
        <SectionBlock key={section.key} section={section}>
          <ul>
            {section.rows.map((row, i) => (
              <Fragment key={row.task.id}>
                {(row.gapBefore || row.header) && (
                  <li aria-hidden>
                    <RowLead row={row} />
                  </li>
                )}
                <TaskRow
                  task={row.task}
                  blockIndex={row.blockIndex}
                  lineAbove={row.lineAbove}
                  labelInHeader={labelInHeader(config, row)}
                  {...extras?.(section, i)}
                />
              </Fragment>
            ))}
          </ul>
        </SectionBlock>
      ))}
    </div>
  );
}
