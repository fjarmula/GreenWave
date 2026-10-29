"use client";
import { useTranslation } from "@/components/language-provider";

import { ThemeToggle } from "@/components/hud/ThemeToggle";
import { ResponsiveNavigation } from "@/components/workspace/ResponsiveNavigation";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { useIsPhone } from "@/lib/useIsPhone";
import { docsContent } from "@/lib/docs/content";
import { DocsBlocks } from "./DocsBlocks";
import { DocsTabs } from "./DocsTabs";
import { useDocsSection } from "./useDocsSection";

export function DocsWorkspace() {
  const { t, language } = useTranslation();
  const phone = useIsPhone();
  const [active, select] = useDocsSection();
  const sections = docsContent[language];
  const section = sections.find((item) => item.id === active) ?? sections[0];
  return (
    <main className="home-main content-page pt-32 pb-10 sm:pt-36">
      <WorkspaceHeader variant="page" compact={phone} actions={!phone && <ThemeToggle />}>
        <ResponsiveNavigation current="/docs" title={t("Documentation")} heading={false} />
      </WorkspaceHeader>
      <h1 className="mb-6 text-3xl font-semibold tracking-tight sm:text-4xl">
        {t("Contest documentation")}
      </h1>
      <DocsTabs sections={sections} active={section.id} onSelect={select} />
      <section
        role="tabpanel"
        id={`docs-panel-${section.id}`}
        aria-labelledby={`docs-tab-${section.id}`}
        tabIndex={0}
        className="docs-panel"
      >
        <h2 className="mb-4 text-xl font-semibold tracking-tight">{section.title}</h2>
        <DocsBlocks blocks={section.blocks} />
      </section>
    </main>
  );
}
