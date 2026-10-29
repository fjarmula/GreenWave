"use client";
import { useTranslation } from "@/components/language-provider";
import { useEffect, useRef } from "react";
import type { DocsSection } from "@/lib/docs/content";
import { nextTabIndex, type DocsSectionId } from "@/lib/docs/tabs";

export function DocsTabs({
  sections,
  active,
  onSelect,
  orientation = "horizontal",
}: {
  sections: DocsSection[];
  active: DocsSectionId;
  onSelect: (id: DocsSectionId) => void;
  orientation?: "horizontal" | "vertical";
}) {
  const { t } = useTranslation();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = sections.findIndex((section) => section.id === active);
  useEffect(() => {
    tabs.current[activeIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeIndex, orientation]);
  return (
    <div
      role="tablist"
      aria-label={t("Documentation sections")}
      aria-orientation={orientation}
      className="docs-tabs"
    >
      {sections.map((section, index) => (
        <button
          key={section.id}
          ref={(element) => {
            tabs.current[index] = element;
          }}
          type="button"
          role="tab"
          id={`docs-tab-${section.id}`}
          aria-controls={`docs-panel-${section.id}`}
          aria-selected={section.id === active}
          tabIndex={section.id === active ? 0 : -1}
          className="docs-tab"
          onClick={() => onSelect(section.id)}
          onKeyDown={(event) => {
            const next = nextTabIndex(event.key, index, sections.length, orientation);
            if (next === null) return;
            event.preventDefault();
            tabs.current[next]?.focus();
            onSelect(sections[next].id);
          }}
        >
          {section.label}
        </button>
      ))}
    </div>
  );
}
