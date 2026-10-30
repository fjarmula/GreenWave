"use client";
import { useTranslation } from "@/components/language-provider";
import { useEffect, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { ThemeToggle } from "@/components/hud/ThemeToggle";
import { ResponsiveNavigation } from "@/components/workspace/ResponsiveNavigation";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { useIsPhone } from "@/lib/useIsPhone";
import { DOCS_REPOSITORY, docsContent } from "@/lib/docs/content";
import { DocsBackdrop } from "./DocsBackdrop";
import { DocsFooter } from "./DocsFooter";
import { DocsSectionView } from "./DocsSectionView";
import { DocsTabs } from "./DocsTabs";
import { useDocsSection } from "./useDocsSection";

/** `className` carries the route-scoped math font variable. */
export function DocsWorkspace({ className }: { className?: string }) {
  const { t, language } = useTranslation();
  const phone = useIsPhone();
  const [active, select] = useDocsSection();
  const panel = useRef<HTMLElement>(null);
  const previous = useRef(active);
  useEffect(() => {
    if (previous.current === active) return;
    previous.current = active;
    const element = panel.current;
    if (!element) return;
    const margin = parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
    // Keep a new section's beginning visible when switching from a long, scrolled section.
    if (element.getBoundingClientRect().top < margin)
      element.scrollIntoView({ block: "start", behavior: "instant" });
  }, [active]);
  const sections = docsContent[language];
  const section = sections.find((item) => item.id === active) ?? sections[0];
  return (
    <main className={["home-main content-page docs-page", className].filter(Boolean).join(" ")}>
      <DocsBackdrop />
      <WorkspaceHeader variant="page" compact={phone} actions={!phone && <ThemeToggle />}>
        <ResponsiveNavigation current="/docs" title={t("Documentation")} heading={false} />
      </WorkspaceHeader>
      <div className="docs-head">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("Documentation")}</h1>
        <div className="docs-head-meta">
          <span
            data-testid="simulation-mode-badge"
            className="inline-flex items-center gap-2 rounded-full border border-neutral-700/60 bg-zinc-900/80 px-2.5 py-1 text-xs font-medium text-amber-200"
          >
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-amber-500" />
            {t("Simulation mode")}
          </span>
          <a className="docs-chip" href={DOCS_REPOSITORY} target="_blank" rel="noopener">
            GitHub <ArrowUpRight aria-hidden className="size-4 shrink-0" />
          </a>
        </div>
      </div>
      <div className="docs-layout">
        <aside className="docs-navigation">
          <DocsTabs
            sections={sections}
            active={section.id}
            onSelect={select}
            orientation={phone ? "horizontal" : "vertical"}
          />
        </aside>
        <section
          ref={panel}
          role="tabpanel"
          id={`docs-panel-${section.id}`}
          aria-labelledby={`docs-tab-${section.id}`}
          tabIndex={0}
          className="docs-panel"
        >
          <h2 className="docs-section-title">{section.title}</h2>
          <DocsSectionView section={section} />
        </section>
      </div>
      <DocsFooter language={language} />
    </main>
  );
}
