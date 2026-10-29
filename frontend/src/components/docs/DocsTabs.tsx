"use client";
import { useTranslation } from "@/components/language-provider";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { DocsSection } from "@/lib/docs/content";
import { nextTabIndex, type DocsSectionId } from "@/lib/docs/tabs";

export type DocsSelectVia = "pointer" | "keyboard";

/** WAI-ARIA tabs with automatic activation, on the shared segmented track with one sliding thumb. */
export function DocsTabs({
  sections,
  active,
  onSelect,
}: {
  sections: DocsSection[];
  active: DocsSectionId;
  onSelect: (id: DocsSectionId, via: DocsSelectVia) => void;
}) {
  const { t } = useTranslation();
  const list = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  // Pointer switches slide the thumb; keyboard switches repeat quickly, so they jump.
  const slide = useRef(false);
  const activeIndex = sections.findIndex((section) => section.id === active);

  useEffect(() => {
    tabs.current[activeIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeIndex]);

  useLayoutEffect(() => {
    const track = list.current;
    const element = thumb.current;
    if (!track || !element) return;
    const place = (animate: boolean) => {
      const tab = tabs.current[activeIndex];
      if (!tab) return;
      element.style.transition = animate ? "" : "none";
      element.style.width = `${tab.offsetWidth}px`;
      element.style.transform = `translateX(${tab.offsetLeft}px)`;
      track.dataset.thumb = "";
    };
    place(slide.current);
    slide.current = false;
    // Labels change width with the language and once the web font loads. The observer also fires
    // once on observe; skipping that keeps it from cancelling the slide just started.
    let width = track.scrollWidth;
    const observer = new ResizeObserver(() => {
      if (track.scrollWidth === width) return;
      width = track.scrollWidth;
      place(false);
    });
    observer.observe(track);
    return () => observer.disconnect();
  }, [activeIndex, sections]);

  return (
    <div
      ref={list}
      role="tablist"
      aria-label={t("Documentation sections")}
      className="docs-tabs hud-segmented"
    >
      <span aria-hidden="true" className="docs-tab-thumb" ref={thumb} />
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
            onClick={() => {
              slide.current = true;
              onSelect(section.id, "pointer");
            }}
            onKeyDown={(event) => {
              const next = nextTabIndex(event.key, index, sections.length);
              if (next === null) return;
              event.preventDefault();
              tabs.current[next]?.focus();
              onSelect(sections[next].id, "keyboard");
            }}
          >
            {section.label}
          </button>
        );
      })}
    </div>
  );
}
