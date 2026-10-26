import type { ReactNode } from "react";

/** One pinned glass header for every workspace: page content left, actions right. */
export function WorkspaceHeader({
  children,
  actions,
  variant = "map",
  hidden = false,
}: {
  children: ReactNode;
  actions: ReactNode;
  /** `map` floats over a full-screen map; `page` stays pinned over scrolling content. */
  variant?: "map" | "page";
  hidden?: boolean;
}) {
  return (
    <header
      className="workspace-header"
      data-variant={variant}
      data-map-occluder
      hidden={hidden}
      inert={hidden}
    >
      {children}
      <div className="workspace-actions">{actions}</div>
    </header>
  );
}
