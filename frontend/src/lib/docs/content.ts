import type { Language } from "@/lib/localization";
import type { DocsSectionId } from "./tabs";

export type ArchitectureNodeId =
  "sources" | "etl" | "dataset" | "api" | "its" | "stream" | "dashboard";

export type DocsBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "code"; label: string; code: string }
  | { kind: "links"; items: { label: string; href: string }[] }
  | {
      kind: "diagram";
      diagram: "architecture";
      nodes: Record<ArchitectureNodeId, string>;
      caption: string;
    }
  /** A simulation-only callout. */
  | { kind: "note"; text: string };

export interface DocsSection {
  id: DocsSectionId;
  label: string;
  title: string;
  blocks: DocsBlock[];
}

/** Contest documentation (§5.2 of the Open Data App rules), already localized: not passed through t(). */
export const docsContent: Record<Language, DocsSection[]> = {
  pl: [
    {
      id: "about",
      label: "O projekcie",
      title: "O projekcie",
      blocks: [{ kind: "paragraph", text: "Opis projektu." }],
    },
    {
      id: "run",
      label: "Uruchomienie",
      title: "Uruchomienie",
      blocks: [{ kind: "paragraph", text: "Instrukcja uruchomienia." }],
    },
    {
      id: "tech",
      label: "Technologie",
      title: "Technologie",
      blocks: [{ kind: "paragraph", text: "Użyte technologie." }],
    },
    {
      id: "data",
      label: "Dane",
      title: "Dane",
      blocks: [{ kind: "paragraph", text: "Wykorzystane dane." }],
    },
    {
      id: "architecture",
      label: "Architektura",
      title: "Architektura",
      blocks: [
        { kind: "paragraph", text: "Architektura rozwiązania." },
        { kind: "note", text: "Wyłącznie symulacja." },
      ],
    },
    {
      id: "roadmap",
      label: "Rozwój",
      title: "Rozwój",
      blocks: [{ kind: "paragraph", text: "Możliwości rozwoju." }],
    },
  ],
  en: [
    {
      id: "about",
      label: "About",
      title: "About",
      blocks: [{ kind: "paragraph", text: "Project description." }],
    },
    {
      id: "run",
      label: "Running it",
      title: "Running it",
      blocks: [{ kind: "paragraph", text: "How to run it." }],
    },
    {
      id: "tech",
      label: "Technologies",
      title: "Technologies",
      blocks: [{ kind: "paragraph", text: "Technologies used." }],
    },
    {
      id: "data",
      label: "Data",
      title: "Data",
      blocks: [{ kind: "paragraph", text: "Data used." }],
    },
    {
      id: "architecture",
      label: "Architecture",
      title: "Architecture",
      blocks: [
        { kind: "paragraph", text: "Solution architecture." },
        { kind: "note", text: "Simulation only." },
      ],
    },
    {
      id: "roadmap",
      label: "Future development",
      title: "Future development",
      blocks: [{ kind: "paragraph", text: "Development potential." }],
    },
  ],
};
