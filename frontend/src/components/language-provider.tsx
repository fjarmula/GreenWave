"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { LANGUAGE_COOKIE, translatePresentation, type Language } from "@/lib/localization";

const LanguageContext = createContext<{
  language: Language;
  setLanguage: (language: Language) => void;
}>({ language: "pl", setLanguage: () => undefined });

export function LanguageProvider({
  children,
  initialLanguage = "pl",
}: {
  children: ReactNode;
  initialLanguage?: Language;
}) {
  const [language, setLanguage] = useState(initialLanguage);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  function selectLanguage(next: Language) {
    // A cookie lets the next server render use the preference without a language flash.
    document.cookie = `${LANGUAGE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setLanguage(next);
  }
  return (
    <LanguageContext value={{ language, setLanguage: selectLanguage }}>{children}</LanguageContext>
  );
}

export function useTranslation() {
  const { language, setLanguage } = useContext(LanguageContext);
  const t = useCallback(<T,>(value: T): T => translatePresentation(value, language), [language]);
  return { language, setLanguage, t };
}
