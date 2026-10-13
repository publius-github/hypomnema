import { useDroppable } from "@dnd-kit/core";
import { memo } from "react";
import { useAppStore } from "../store";
import { currentAndNextBlock, dayLabel } from "../lib/tasks";
import { useDaySections } from "../hooks/useColumnSections";
import TaskCard from "./TaskCard";
import QuickAdd from "./QuickAdd";
import SectionBlock, {
  labelInHeader,
  railColor,
  RowLead,
} from "./ColumnSection";

function DayColumn({
  date,
  onOpenTask,
}: {
  date: string;
  onOpenTask: (id: number) => void;
}) {
  // individual selectors: a whole-store subscribe would re-render every
  // column on unrelated state changes (toasts, palette, banners)
  const config = useAppStore((s) => s.config);
  const today = useAppStore((s) => s.today);
  const dashboard = useAppStore((s) => s.dashboard);
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}` });

  const reminders =
    dashboard?.days.find((d) => d.date === date)?.reminders ?? [];
  const schedule =
    date === today && dashboard
      ? currentAndNextBlock(dashboard.blocks, new Date())
      : null;

  // cadence sections, then Postponed / Done, waiting / Done; tasks are
  // hairline-separated rows sitting flush, the breaks between them are
  // whole separator stripes (GapFill) - the same layout the phone's day
  // screen renders
  const sections = useDaySections(date);

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-0 flex-col rounded-lg border ${
        isOver ? "border-accent" : "border-line"
      } ${
        // the whole column takes the card fill: rows and gaps share one
        // work surface the theme contrasts against the page
        "bg-surface-alt"
      }`}
    >
      <div
        // one color for every header, Today included: it follows the
        // main text tone (and the day_header_color override); Today is
        // marked by the [Today] suffix and the column tint instead of
        // its own accent color, so color settings behave uniformly
        className={`truncate px-2.5 py-2 text-base font-semibold text-content ${
          config?.day_header_centered ? "text-center" : ""
        }`}
        style={
          config?.day_header_color
            ? { color: config.day_header_color }
            : undefined
        }
        title={dayLabel(date, today)}
      >
        {dayLabel(date, today)}
      </div>
      {(reminders.length > 0 || schedule) && (
        <div className="flex flex-col gap-0.5 px-2.5 pb-1.5 text-[11px] text-content-muted">
          {reminders.map((text, i) => (
            <div
              key={i}
              className="italic"
              style={
                config?.reminder_color
                  ? { color: config.reminder_color }
                  : undefined
              }
            >
              {text}
            </div>
          ))}
          {schedule?.current && (
            <div>
              <span className="font-medium text-accent">Now:</span>{" "}
              {schedule.current.label} (until {schedule.current.to})
            </div>
          )}
          {schedule?.next && (
            <div>
              <span className="font-medium">Next:</span> {schedule.next.label}{" "}
              at {schedule.next.from}
            </div>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
        {sections.map((section) => (
          <SectionBlock key={section.key} section={section}>
            {section.rows.map((row) => (
              <div key={row.task.id}>
                <RowLead row={row} />
                <TaskCard
                  task={row.task}
                  onOpen={onOpenTask}
                  blockIndex={row.blockIndex}
                  // every block is framed: its first row also gets
                  // the line above, not only the one below
                  lineAbove={row.lineAbove}
                  labelInHeader={labelInHeader(config, row)}
                  sectionColor={railColor(config, section)}
                />
              </div>
            ))}
          </SectionBlock>
        ))}
        <QuickAdd target={{ scheduled_date: date }} />
      </div>
    </div>
  );
}

export default memo(DayColumn);
