"use client";
import { useTranslation } from "@/components/language-provider";

import { useEffect, useRef } from "react";
import type { DocsSection } from "@/lib/docs/content";
import { nextTabIndex, type DocsSectionId } from "@/lib/docs/tabs";

/** WAI-ARIA tabs with automatic activation, on the shared segmented track. */
export function DocsTabs({
  sections,
  active,
  onSelect,
}: {
  sections: DocsSection[];
  active: DocsSectionId;
  onSelect: (id: DocsSectionId) => void;
}) {
  const { t } = useTranslation();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = sections.findIndex((section) => section.id === active);

  useEffect(() => {
    tabs.current[activeIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeIndex]);

  return (
    <div
      role="tablist"
      aria-label={t("Documentation sections")}
      className="docs-tabs hud-segmented"
    >
      {sections.map((section, index) => {
        const selected = section.id === active;
        return (
          <button
            key={section.id}
            ref={(element) => {
              tabs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={`docs-tab-${section.id}`}
            aria-controls={`docs-panel-${section.id}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="hud-segment pressable"
            onClick={() => onSelect(section.id)}
            onKeyDown={(event) => {
              const next = nextTabIndex(event.key, index, sections.length);
              if (next === null) return;
              event.preventDefault();
              tabs.current[next]?.focus();
              onSelect(sections[next].id);
            }}
          >
            {section.label}
          </button>
        );
      })}
    </div>
  );
}
