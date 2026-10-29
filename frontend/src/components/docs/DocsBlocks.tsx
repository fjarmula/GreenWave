import { Info } from "lucide-react";
import type { DocsBlock } from "@/lib/docs/content";
import { ArchitectureDiagram } from "./ArchitectureDiagram";
import { CodeBlock } from "./CodeBlock";

function Block({ block }: { block: DocsBlock }) {
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
      return (
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
      );
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
