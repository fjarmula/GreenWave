import { renderToStaticMarkup as render } from "react-dom/server";
import type { ReactNode } from "react";
import { LanguageProvider } from "@/components/language-provider";

/** Existing English presentation assertions exercise the supported English locale explicitly. */
export function renderToStaticMarkup(node: ReactNode) {
  return render(<LanguageProvider initialLanguage="en">{node}</LanguageProvider>);
}
