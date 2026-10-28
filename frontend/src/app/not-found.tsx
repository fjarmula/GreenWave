"use client";
import Link from "next/link";
import { useTranslation } from "@/components/language-provider";
import { LanguageSwitch } from "@/components/workspace/LanguageSwitch";

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="absolute top-4 right-4">
        <LanguageSwitch />
      </div>
      <section className="space-y-4 text-center">
        <h1 className="hud-title text-lg">{t("Page not found")}</h1>
        <p>{t("This page does not exist.")}</p>
        <Link href="/" className="hud-secondary pressable">
          {t("Return home")}
        </Link>
      </section>
    </main>
  );
}
