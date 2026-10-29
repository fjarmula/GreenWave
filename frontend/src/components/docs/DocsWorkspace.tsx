"use client";
import { useTranslation } from "@/components/language-provider";
import { useEffect, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { ThemeToggle } from "@/components/hud/ThemeToggle";
import { ResponsiveNavigation } from "@/components/workspace/ResponsiveNavigation";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { useIsPhone } from "@/lib/useIsPhone";
import { DEMO_URL, docsContent } from "@/lib/docs/content";
import { DocsBackdrop } from "./DocsBackdrop";
import { DocsSectionView } from "./DocsSectionView";
import { DocsTabs } from "./DocsTabs";
import { useDocsSection } from "./useDocsSection";

export function DocsWorkspace() {
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
    <main className="home-main content-page docs-page">
      <DocsBackdrop />
      <WorkspaceHeader variant="page" compact={phone} actions={!phone && <ThemeToggle />}>
        <ResponsiveNavigation current="/docs" title={t("Documentation")} heading={false} />
      </WorkspaceHeader>
      <div className="docs-head">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("Documentation")}</h1>
        <div className="docs-head-meta">
          <span className="docs-chip docs-chip-sim">{t("Simulation only")}</span>
          <a className="docs-chip" href={DEMO_URL} target="_blank" rel="noopener">
            {t("Live demo")} <ArrowUpRight aria-hidden className="size-4 shrink-0" />
          </a>
          <a
            className="docs-chip"
            href="https://github.com/fjarmula/GreenWave"
            target="_blank"
            rel="noopener"
          >
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
    </main>
  );
}
