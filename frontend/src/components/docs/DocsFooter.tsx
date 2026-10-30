import { ArrowUpRight } from "lucide-react";
import type { Language } from "@/lib/localization";
import { DOCS_AUTHORS, DOCS_REPOSITORY, docsFooter } from "@/lib/docs/content";

/** Credits shared by every docs tab: authors' GitHub profiles and the repository. */
export function DocsFooter({ language }: { language: Language }) {
  const copy = docsFooter[language];
  return (
    <footer className="docs-footer">
      <div className="docs-footer-group">
        <h2>{copy.authors}</h2>
        <ul>
          {DOCS_AUTHORS.map(({ name, github }) => (
            <li key={github}>
              <a href={`https://github.com/${github}`} target="_blank" rel="noopener">
                {name}
                <span className="docs-footer-handle">@{github}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
      <div className="docs-footer-group">
        <h2>{copy.repository}</h2>
        <a href={DOCS_REPOSITORY} target="_blank" rel="noopener">
          fjarmula/GreenWave <ArrowUpRight aria-hidden className="size-4 shrink-0" />
        </a>
      </div>
      <p className="docs-footer-notice">{copy.notice}</p>
    </footer>
  );
}
