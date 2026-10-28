"use client";
import { useTranslation } from "@/components/language-provider";

export function LanguageSwitch() {
  const { language, setLanguage } = useTranslation();
  return (
    <div className="language-switch" role="group" aria-label="Język / Language">
      {(["pl", "en"] as const).map((value) => (
        <button
          key={value}
          type="button"
          lang={value}
          aria-label={value === "pl" ? "Polski" : "English"}
          aria-pressed={language === value}
          onClick={() => setLanguage(value)}
        >
          {value === "pl" ? "PL" : "ENG"}
        </button>
      ))}
    </div>
  );
}
