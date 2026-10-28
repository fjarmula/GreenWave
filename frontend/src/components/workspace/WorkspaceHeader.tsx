"use client";
import { useTranslation } from "@/components/language-provider";

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
        {actions}
      </div>
    </header>
  );
}
