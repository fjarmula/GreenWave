/**
 * Which home background to draw. The live map only on a hydrated wide screen with WebGL whose map
 * has not failed; everything else (server render, phones, no WebGL, offline) gets the drawing.
 */
export function backdropKind({
  hydrated,
  phone,
  webgl,
  failed,
}: {
  hydrated: boolean;
  phone: boolean;
  webgl: boolean;
  failed: boolean;
}): "static" | "live" {
  return hydrated && !phone && webgl && !failed ? "live" : "static";
}

export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}
