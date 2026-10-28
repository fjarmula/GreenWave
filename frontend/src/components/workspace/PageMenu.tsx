"use client";
import { useTranslation } from "@/components/language-provider";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Menu } from "lucide-react";
import { WorkspaceNavigation } from "@/components/workspace/WorkspaceNavigation";

/**
 * A one-row header: the current page as a button that opens the workspace destinations. The
 * page heading wraps the button (a heading inside a button is not valid HTML).
 */
export function PageMenu({
  current,
  title,
  tools,
  heading = true,
}: {
  current: string;
  title: string;
  tools?: ReactNode;
  heading?: boolean;
}) {
  const { t } = useTranslation();
  const Heading = heading ? "h1" : "p";
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  return (
    <div
      ref={root}
      className="page-menu-root"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest(".page-menu a")) setOpen(false);
      }}
    >
      <Heading className="workspace-title page-menu-heading">
        <button
          ref={trigger}
          type="button"
          className="page-menu-trigger pressable"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen(!open)}
        >
          <Menu aria-hidden />
          <span className="page-menu-label">{t(title)}</span>
          <ChevronDown aria-hidden className="page-menu-chevron" />
        </button>
      </Heading>
      <div id={menuId} className="page-menu surface-glass" hidden={!open}>
        <WorkspaceNavigation current={current} />
        {tools && <div className="page-menu-tools">{t(tools)}</div>}
      </div>
    </div>
  );
}
