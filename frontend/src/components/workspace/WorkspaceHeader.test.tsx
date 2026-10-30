import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LanguageProvider } from "@/components/language-provider";
import { DOCS_REPOSITORY } from "@/lib/docs/content";
import { WorkspaceHeader } from "./WorkspaceHeader";

describe.each([false, true])("repository link (compact: %s)", (compact) => {
  it.each(["pl", "en"] as const)("offers a safe, localized external link in %s", (language) => {
    const label =
      language === "pl" ? "Zobacz kod źródłowy na GitHubie" : "View source code on GitHub";
    const html = renderToStaticMarkup(
      <LanguageProvider initialLanguage={language}>
        <WorkspaceHeader compact={compact} actions={<button>Utility</button>}>
          <h1>Workspace</h1>
        </WorkspaceHeader>
      </LanguageProvider>,
    );
    const anchors = html.match(/<a\b[^>]*>/g) ?? [];
    const repository = anchors.filter((anchor) => anchor.includes(`href="${DOCS_REPOSITORY}"`));
    expect(repository).toHaveLength(1);
    expect(repository[0]).toContain('target="_blank"');
    expect(repository[0]).toContain('rel="noopener noreferrer"');
    expect(repository[0]).toContain(`aria-label="${label}"`);
    expect(repository[0]).toContain(`title="${label}"`);
    expect(repository[0]).toContain("workspace-button");
    expect(html.indexOf(repository[0])).toBeGreaterThan(html.indexOf('class="workspace-actions"'));
    expect(html).toContain('aria-label="Język / Language"');
    expect(html).toContain("Utility");
  });
});
