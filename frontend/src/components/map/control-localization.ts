import { translate, type Language } from "@/lib/localization";

type Control = { title: string; setAttribute: (name: string, value: string) => void };

/** MapLibre has no public runtime locale setter; update only the controls' presentation. */
export function localizeMapControls(
  root: { querySelector: (selector: string) => Control | null },
  language: Language,
) {
  for (const [selector, label] of [
    [".maplibregl-ctrl-zoom-in", "Zoom in"],
    [".maplibregl-ctrl-zoom-out", "Zoom out"],
    [".maplibregl-ctrl-attrib-button", "Toggle attribution"],
    [".maplibregl-canvas", "Map"],
  ]) {
    const element = root.querySelector(selector);
    if (!element) continue;
    const text = translate(label, language);
    element.title = text;
    element.setAttribute("aria-label", text);
  }
}
