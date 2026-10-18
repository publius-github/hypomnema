import { dowLabelParts } from "../lib/tasks";
import type { Task } from "../types";

/** The inside of a task's [DOW] marker, the day it fired on in bold. */
export default function DowLabelText({
  label,
  task,
}: {
  label: string;
  task: Task;
}) {
  // origin_date survives the overdue carry-over; scheduled_date does not
  const parts = dowLabelParts(label, task.origin_date ?? task.scheduled_date);
  return (
    <>
      {parts.map((part, i) =>
        part.hit ? (
          <b key={i} className="font-bold">
            {part.text}
          </b>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
