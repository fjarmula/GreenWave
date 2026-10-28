"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useTranslation } from "./language-provider";
import { destinations } from "@/lib/workspace-routes";

/** Update the current title immediately; the next server render reads the language cookie. */
export function LanguageMetadata() {
  const pathname = usePathname();
  const { t } = useTranslation();
  useEffect(() => {
    const destination = destinations.find((item) => item.href === pathname);
    document.title =
      pathname === "/"
        ? "ER-GreenWave"
        : `${t(destination?.label ?? "ER-GreenWave")} · ER-GreenWave`;
  }, [pathname, t]);
  return null;
}
