import { useState } from "react";
import { useBackStep } from "./back";
import MobileUpcoming from "./MobileUpcoming";
import MobileReminders from "./MobileReminders";
import MobileCalendar from "./MobileCalendar";
import MobileReview from "./MobileReview";
import MobileSettings from "./MobileSettings";

type Screen = "upcoming" | "reminders" | "calendar" | "review" | "settings";

const SCREENS: { id: Screen; label: string; hint: string }[] = [
  {
    id: "upcoming",
    label: "Upcoming",
    hint: "Scheduled events, birthdays, recurring rules",
  },
  {
    id: "reminders",
    label: "Reminders",
    hint: "Weekly focus, day reminders, schedule blocks",
  },
  { id: "calendar", label: "Calendar", hint: "The month, to look at" },
  { id: "review", label: "Review", hint: "How the week went" },
  { id: "settings", label: "Settings", hint: "Sync, passphrase, engine" },
];

/**
 * The fifth tab, holding the sections that do not earn a permanent seat
 * on a five-slot bar.
 *
 * Day, Lists, Journal and Notes are opened many times a day; a birthday
 * is added twice a year. Giving each its own tab would shrink all of
 * them to fit, which is the trade a phone cannot afford - so the rare
 * ones share one door.
 */
export default function MobileMore() {
  const [screen, setScreen] = useState<Screen | null>(null);
  useBackStep(screen !== null, () => setScreen(null));

  if (screen) {
    const entry = SCREENS.find((s) => s.id === screen);
    return (
      <div className="flex h-full flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-3">
          <button
            onClick={() => setScreen(null)}
            className="px-2 py-1 text-content-muted"
          >
            ‹ More
          </button>
          <span className="font-semibold">{entry?.label}</span>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          {screen === "upcoming" && <MobileUpcoming />}
          {screen === "reminders" && <MobileReminders />}
          {screen === "calendar" && <MobileCalendar />}
          {screen === "review" && <MobileReview />}
          {screen === "settings" && <MobileSettings />}
        </div>
      </div>
    );
  }

  return (
    <ul>
      {SCREENS.map((entry) => (
        <li key={entry.id} className="border-b border-line/60">
          <button
            onClick={() => setScreen(entry.id)}
            className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
          >
            <span className="min-w-0">
              <span className="block">{entry.label}</span>
              <span className="block wrap-break-word text-xs text-content-muted">
                {entry.hint}
              </span>
            </span>
            <span aria-hidden className="shrink-0 text-content-muted">
              ›
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
