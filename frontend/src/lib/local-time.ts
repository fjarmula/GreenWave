/** Kraków wall-clock time: the zone the backend reads naive scenario times in (ADR 0014). */
const WARSAW_PARTS = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** `date` as a Kraków `"YYYY-MM-DDTHH:MM"` (a `datetime-local` value), rounded down to `step` minutes. */
export function warsawMinute(date: Date, step = 1): string {
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    WARSAW_PARTS.formatToParts(date).find((p) => p.type === type)?.value ?? "00";
  const minute = Number(part("minute"));
  const rounded = String(minute - (minute % step)).padStart(2, "0");
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${rounded}`;
}
