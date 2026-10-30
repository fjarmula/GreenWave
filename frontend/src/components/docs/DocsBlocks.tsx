import { Info } from "lucide-react";
import type { DocsBlock } from "@/lib/docs/content";
import { ArchitectureDiagram } from "./ArchitectureDiagram";
import { CodeBlock } from "./CodeBlock";
import { FlowDiagram } from "./FlowDiagram";
import { MathNotation } from "./MathNotation";

export function Block({ block }: { block: DocsBlock }) {
  switch (block.kind) {
    case "paragraph":
      return <p>{block.text}</p>;
    case "heading":
      return <h3>{block.text}</h3>;
    case "list":
      return (
        <ul>
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "table":
      if (block.cards)
        return (
          <ul className="docs-cards">
            {block.rows.map(([label, title, ...text]) => (
              <li className="docs-card" key={label}>
                <span className="docs-card-label">{label}</span>
                <strong>{title}</strong>
                {text.map((cell) => (
                  <p key={cell}>{cell}</p>
                ))}
              </li>
            ))}
          </ul>
        );
      return (
        <div className="docs-data-table">
          <div className="docs-table-scroll">
            <table>
              <thead>
                <tr>
                  {block.columns.map((column) => (
                    <th scope="col" key={column}>
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row) => (
                  <tr key={row[0]}>
                    {row.map((cell, index) => (
                      <td key={index}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="docs-table-mobile">
            {block.rows.map((row) => (
              <section className="docs-source" key={row[0]}>
                <h3>{row[0]}</h3>
                <dl>
                  {block.columns.slice(1).map((column, index) => (
                    <div key={column}>
                      <dt>{column}</dt>
                      <dd>{row[index + 1]}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </div>
      );
    case "formula":
      return (
        <figure className="docs-notation">
          <figcaption>{block.label}</figcaption>
          <MathNotation expression={block.expression} />
        </figure>
      );
    case "flow":
      return <FlowDiagram label={block.label} steps={block.steps} cycle={block.cycle} />;
    case "code":
      return <CodeBlock label={block.label} code={block.code} />;
    case "links":
      return (
        <ul className="docs-links">
          {block.items.map(({ label, href }) => (
            <li key={href}>
              <a href={href} target="_blank" rel="noopener">
                {label}
              </a>
            </li>
          ))}
        </ul>
      );
    case "diagram":
      return <ArchitectureDiagram nodes={block.nodes} caption={block.caption} />;
    case "note":
      return (
        <p role="note" className="docs-note">
          <Info aria-hidden className="size-4 shrink-0" />
          <span>{block.text}</span>
        </p>
      );
  }
}

export function DocsBlocks({ blocks }: { blocks: DocsBlock[] }) {
  return (
    <div className="docs-prose">
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}
