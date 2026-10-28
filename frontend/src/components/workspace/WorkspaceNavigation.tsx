"use client";
import { useTranslation } from "@/components/language-provider";
import Link from "next/link";
import { destinations } from "@/lib/workspace-routes";
export function WorkspaceNavigation({ current }: { current: string }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("Workspace navigation")} className="workspace-navigation">
      {destinations.map(({ href, label }) => (
        <Link key={href} href={href} aria-current={href === current ? "page" : undefined}>
          {t(label)}
        </Link>
      ))}
    </nav>
  );
}
