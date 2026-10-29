"use client";
import { useTranslation } from "@/components/language-provider";

import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import { copyText } from "@/lib/docs/copy";

const UNAVAILABLE = "Copy unavailable. Select the text to copy manually.";

export function CodeBlock({ label, code }: { label: string; code: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    const copied = await copyText(
      code,
      typeof navigator === "undefined" ? undefined : navigator.clipboard,
    );
    setStatus(copied ? "Copied" : UNAVAILABLE);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(""), 2000);
  }

  return (
    <figure className="docs-code">
      <figcaption className="docs-code-header">
        <span>{label}</span>
        <span role="status" className="docs-code-status">
          {status && t(status)}
        </span>
        <button type="button" className="json-inspect-button pressable" onClick={copy}>
          <Copy aria-hidden className="size-3.5" />
          {t("Copy")}
        </button>
      </figcaption>
      <pre>
        <code>{code}</code>
      </pre>
    </figure>
  );
}
