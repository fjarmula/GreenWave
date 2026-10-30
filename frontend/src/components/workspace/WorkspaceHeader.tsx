"use client";
import { useTranslation } from "@/components/language-provider";
import { DOCS_REPOSITORY } from "@/lib/docs/content";

import { LanguageSwitch } from "./LanguageSwitch";
import Link from "next/link";
import { GreenWaveMark } from "./GreenWaveMark";
import { useEffect, useRef, type ReactNode } from "react";

/** One pinned glass header for every workspace: page content left, actions right. */
export function WorkspaceHeader({
  children,
  actions,
  variant = "map",
  hidden = false,
  compact = false,
}: {
  children: ReactNode;
  actions: ReactNode;
  /** `map` floats over a full-screen map; `page` stays pinned over scrolling content. */
  variant?: "map" | "page";
  hidden?: boolean;
  /** Compact phone header paired with the shared page menu. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const element = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = element.current;
    const shell = header?.closest<HTMLElement>(".workspace-shell, .home-main");
    if (!header || !shell) return;
    const actions = header.querySelector<HTMLElement>(".workspace-actions");
    const measure = () => {
      if (header.hidden) return;
      shell.style.setProperty(
        "--workspace-header-bottom",
        `${header.offsetTop + header.offsetHeight}px`,
      );
      // Map overlays beside the header keep clear of its right-hand actions.
      shell.style.setProperty("--workspace-actions-width", `${actions?.offsetWidth ?? 0}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    if (actions) observer.observe(actions);
    return () => observer.disconnect();
  }, []);
  return (
    <header
      ref={element}
      className="workspace-header"
      data-variant={variant}
      data-compact={compact || undefined}
      data-map-occluder
      hidden={hidden}
      inert={hidden}
    >
      <div className="workspace-heading">
        <Link href="/" aria-label={t("ER–GreenWave home")} className="workspace-brand">
          <GreenWaveMark className="size-8" />
        </Link>
        {t(children)}
      </div>
      <div className="workspace-actions">
        <LanguageSwitch />
        <a
          href={DOCS_REPOSITORY}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("View source code on GitHub")}
          title={t("View source code on GitHub")}
          className="workspace-button pressable shrink-0"
        >
          {/* GitHub's Primer mark; Lucide v1 no longer includes brand icons. */}
          <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656" />
          </svg>
        </a>
        {actions}
      </div>
    </header>
  );
}
