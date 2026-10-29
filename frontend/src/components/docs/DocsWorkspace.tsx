"use client";
import { useTranslation } from "@/components/language-provider";

import { useEffect, useRef, useState } from "react";
import { ThemeToggle } from "@/components/hud/ThemeToggle";
import { ResponsiveNavigation } from "@/components/workspace/ResponsiveNavigation";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { useIsPhone } from "@/lib/useIsPhone";
import { DEMO_URL, docsContent } from "@/lib/docs/content";
import { DocsBackdrop } from "./DocsBackdrop";
import { DocsSectionView } from "./DocsSectionView";
import { DocsTabs, type DocsSelectVia } from "./DocsTabs";
import { useDocsSection } from "./useDocsSection";

/** True once the sticky tab track has scrolled up against the header. */
function useStuck() {
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const element = sentinel.current;
    const bar = element?.nextElementSibling;
    if (!element || !bar) return;
    // The sentinel sits right above the bar, so it leaves the viewport's top band as the bar sticks.
    const top = Math.ceil(parseFloat(getComputedStyle(bar).top) || 0) + 1;
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), {
      rootMargin: `-${top}px 0px 0px 0px`,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [sentinel, stuck] as const;
}

export function DocsWorkspace() {
  const { t, language } = useTranslation();
  const phone = useIsPhone();
  const [active, select] = useDocsSection();
  // The panel fades in after a pointer switch; first paint and keyboard switches show it at once.
  const [fade, setFade] = useState(false);
  const [sentinel, stuck] = useStuck();
  const sections = docsContent[language];
  const section = sections.find((item) => item.id === active) ?? sections[0];
  const onSelect = (id: typeof active, via: DocsSelectVia) => {
    setFade(via === "pointer");
    select(id);
  };
  return (
    <main className="home-main content-page docs-page pt-32 pb-16 sm:pt-36">
      <DocsBackdrop />
      <WorkspaceHeader variant="page" compact={phone} actions={!phone && <ThemeToggle />}>
        <ResponsiveNavigation current="/docs" title={t("Documentation")} heading={false} />
      </WorkspaceHeader>
      <div className="docs-head">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          {t("Contest documentation")}
        </h1>
        <p className="docs-head-meta">
          <span className="docs-chip docs-chip-sim">{t("Simulation only")}</span>
          <a className="docs-chip" href={DEMO_URL} target="_blank" rel="noopener">
            {t("Live demo")} ↗
          </a>
        </p>
      </div>
      <div ref={sentinel} className="docs-tabs-sentinel" aria-hidden="true" />
      <div className="docs-tabs-bar" data-stuck={stuck || undefined}>
        <DocsTabs sections={sections} active={section.id} onSelect={onSelect} />
      </div>
      <section
        role="tabpanel"
        id={`docs-panel-${section.id}`}
        aria-labelledby={`docs-tab-${section.id}`}
        tabIndex={0}
        className="docs-panel"
      >
        <div key={section.id} className={fade ? "docs-panel-enter" : undefined}>
          <h2 className="docs-section-title">{section.title}</h2>
          <DocsSectionView section={section} />
        </div>
      </section>
    </main>
  );
}
