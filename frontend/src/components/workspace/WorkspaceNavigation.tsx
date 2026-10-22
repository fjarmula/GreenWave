import Link from "next/link";
import { destinations } from "@/lib/workspace-routes";
export function WorkspaceNavigation({ current }: { current: string }) {
  return (
    <nav aria-label="Workspace navigation" className="workspace-navigation">
      {destinations.map(({ href, label }) => (
        <Link key={href} href={href} aria-current={href === current ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
