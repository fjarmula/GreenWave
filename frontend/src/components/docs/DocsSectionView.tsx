import { useId } from "react";
import type { DocsSection } from "@/lib/docs/content";
import { groupDocsBlocks, type DocsLayoutItem } from "@/lib/docs/layout";
import { Block, DocsBlocks } from "./DocsBlocks";

function Group({
  item,
  step,
}: {
  item: Extract<DocsLayoutItem, { kind: "group" }>;
  step?: number;
}) {
  const id = useId();
  return (
    <section className="docs-group" aria-labelledby={item.heading ? id : undefined}>
      {item.heading && (
        <h3 id={id}>
          {step !== undefined && <span className="docs-step">{step}</span>}
          {item.heading}
        </h3>
      )}
      <DocsBlocks blocks={item.blocks} />
    </section>
  );
}

/** A readable introduction followed by titled subsections and full-width data blocks. */
export function DocsSectionView({ section }: { section: DocsSection }) {
  const { intro, items } = groupDocsBlocks(section.blocks);
  let step = 0;
  return (
    <>
      {intro.length > 0 && (
        <div className="docs-lead">
          {intro.map((block, index) => (
            <Block key={index} block={block} />
          ))}
        </div>
      )}
      <div className="docs-grid">
        {items.map((item, index) => {
          if (item.kind === "group")
            return (
              <Group
                key={index}
                item={item}
                step={section.numbered && item.heading ? ++step : undefined}
              />
            );
          return item.kind === "wide" ? (
            <div key={index} className="docs-wide">
              <Block block={item.block} />
            </div>
          ) : (
            <Block key={index} block={item.block} />
          );
        })}
      </div>
    </>
  );
}
