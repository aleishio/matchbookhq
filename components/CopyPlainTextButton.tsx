"use client";

import { useEffect, useRef, useState } from "react";

type CopyState = "idle" | "copied" | "manual";

export function CopyPlainTextButton({
  label,
  text
}: {
  label: string;
  text: string;
}) {
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const manualCopyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (copyState !== "manual") return;

    const focusTimer = window.setTimeout(() => {
      manualCopyRef.current?.focus();
      manualCopyRef.current?.select();
    }, 0);

    return () => window.clearTimeout(focusTimer);
  }, [copyState]);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("manual");
    }
  }

  return (
    <div className="plain-text-copy">
      <button className="note-btn primary ai-doc-copy-button" onClick={copyText} type="button">
        {copyState === "copied" ? "Copied" : label}
      </button>
      <span aria-live="polite" className={`plain-text-copy-status ${copyState}`}>
        {copyState === "manual"
          ? "Clipboard blocked. Manual copy text is selected."
          : copyState === "copied"
            ? "Plain text copied."
            : "Plain text stays token-light for agent context."}
      </span>
      {copyState === "manual" ? (
        <textarea
          className="plain-text-manual-copy ph-no-capture"
          readOnly
          ref={manualCopyRef}
          value={text}
        />
      ) : null}
    </div>
  );
}
