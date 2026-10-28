import { polish } from "./polish";

export type Language = "pl" | "en";
export const LANGUAGE_COOKIE = "greenwave-language";
export function resolveLanguage(value: string | null | undefined): Language {
  return value === "en" ? "en" : "pl";
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = Object.entries(polish)
  .filter(([key]) => /\{\d+\}/.test(key))
  .map(([key, value]) => ({
    expression: new RegExp(
      `^${key
        .split(/\{\d+\}/)
        .map(escape)
        .join("(.*?)")}$`,
      "s",
    ),
    value,
  }));

/** Translate presentation text only. API payloads, identifiers and JSON stay unchanged. */
export function translate(text: string, language: Language): string {
  if (language === "en") return text;
  const normalized = text.replace(/\s+/g, " ").trim();
  if (Object.hasOwn(polish, text)) return polish[text];
  const direct = Object.hasOwn(polish, normalized) ? polish[normalized] : undefined;
  if (direct)
    return (
      text.slice(0, text.length - text.trimStart().length) +
      direct +
      text.slice(text.trimEnd().length)
    );
  for (const { expression, value } of patterns) {
    const match = expression.exec(text);
    if (match)
      return value.replace(/\{(\d+)\}/g, (_, index: string) =>
        translate(match[Number(index) + 1], language),
      );
  }
  const parts = text.split(/( · | → )/);
  if (parts.length > 1)
    return parts.map((part, index) => (index % 2 ? part : translate(part, language))).join("");
  const date = /^(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/.exec(text);
  if (date) {
    const month = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ].indexOf(date[2]);
    return new Intl.DateTimeFormat("pl-PL", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Europe/Warsaw",
    }).format(new Date(Date.UTC(Number(date[3]), month, Number(date[1]), 12)));
  }
  // Decimal telemetry values use the Polish separator; machine formats are left intact.
  if (/^[+−-]?\d+\.\d+(?: (?:km|m|s|ms))?$/.test(text)) return text.replace(".", ",");
  return text;
}

/** Arrays of text are localized too; React elements and structured data are never traversed. */
export function translatePresentation<T>(value: T, language: Language): T {
  if (typeof value === "string") return translate(value, language) as T;
  if (Array.isArray(value))
    return value.map((item: unknown) => translatePresentation(item, language)) as T;
  return value;
}
