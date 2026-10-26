"use client";
import { PageMenu } from "@/components/workspace/PageMenu";
import { ThemeToggle } from "@/components/hud/ThemeToggle";
import { WorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation";
import { useIsPhone } from "@/lib/useIsPhone";

/** Presentation follows available screen space, independently of the simulation mode. */
export function ResponsiveNavigation({
  current,
  title,
  detail,
  heading = true,
  themeInMenu = true,
}: {
  current: string;
  title: string;
  detail: string;
  heading?: boolean;
  themeInMenu?: boolean;
}) {
  const phone = useIsPhone();
  const Heading = heading ? "h1" : "p";
  return phone ? (
    <PageMenu
      current={current}
      title={title}
      detail={detail}
      heading={heading}
      tools={themeInMenu ? <ThemeToggle /> : undefined}
    />
  ) : (
    <div className="min-w-0 flex-1">
      <WorkspaceNavigation current={current} />
      <Heading className="workspace-title">
        {title} <span className="text-muted-foreground">/ {detail}</span>
      </Heading>
    </div>
  );
}
