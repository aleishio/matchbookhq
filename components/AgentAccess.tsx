"use client";

import { useEffect, useRef, useState } from "react";
import { formatAgentHandoffText, type AgentHandoffSession } from "@/lib/agent-handoff";
import { captureAnalyticsEvent } from "@/lib/analytics";

type AgentCopyTarget = "mcp_config";
type AgentCloseMethod = "button" | "backdrop" | "escape";

type AgentSessionResponse = AgentHandoffSession & {
  tokenLabel: "site_access_token";
};

type SessionState =
  | { status: "idle" }
  | { status: "creating" }
  | { status: "ready"; session: AgentSessionResponse }
  | { status: "error"; message: string };

type CopyState = "idle" | "config-copied" | "manual";

const AGENT_ACCESS_LANE = "cowork";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])'
].join(", ");

function isFocusableVisible(element: HTMLElement) {
  if (element === document.activeElement) return true;

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;

  return element.getClientRects().length > 0;
}

export function AgentAccess() {
  const [isOpen, setIsOpen] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const [manualCopyText, setManualCopyText] = useState("");
  const [sessionState, setSessionState] = useState<SessionState>({ status: "idle" });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const manualCopyRef = useRef<HTMLTextAreaElement>(null);

  const activeSessionText = sessionState.status === "ready"
    ? formatAgentHandoffText(sessionState.session)
    : "";

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    window.setTimeout(() => {
      const firstFocusable = dialogRef.current
        ? Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).find(isFocusableVisible)
        : null;
      firstFocusable?.focus();
    }, 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeDialog("escape");
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusableElements = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter(isFocusableVisible);

      if (focusableElements.length === 0) {
        event.preventDefault();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setCopyState("idle");
    setManualCopyText("");
  }, [isOpen]);

  useEffect(() => {
    if (copyState !== "manual" || !manualCopyText) return;

    const focusTimer = window.setTimeout(() => {
      manualCopyRef.current?.focus();
      manualCopyRef.current?.select();
    }, 0);

    return () => window.clearTimeout(focusTimer);
  }, [copyState, manualCopyText]);

  function openDialog() {
    setCopyState("idle");
    setManualCopyText("");
    setIsOpen(true);
    void createScopedSession();
    captureAnalyticsEvent("agent access opened", {
      default_lane: AGENT_ACCESS_LANE,
      entrypoint: "main_nav"
    });
  }

  function closeDialog(closeMethod: AgentCloseMethod) {
    setIsOpen(false);
    setCopyState("idle");
    setManualCopyText("");
    setSessionState({ status: "idle" });
    captureAnalyticsEvent("agent access closed", {
      close_method: closeMethod,
      lane: AGENT_ACCESS_LANE
    });
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  async function copyText(
    text: string,
    copiedState: Exclude<CopyState, "idle" | "manual">,
    contentType: AgentCopyTarget
  ) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState(copiedState);
      setManualCopyText("");
      captureAnalyticsEvent("agent handoff copied", {
        content_type: contentType,
        lane: AGENT_ACCESS_LANE,
        result: "copied"
      });
    } catch {
      setManualCopyText(text);
      setCopyState("manual");
      captureAnalyticsEvent("agent handoff copied", {
        content_type: contentType,
        lane: AGENT_ACCESS_LANE,
        result: "manual_fallback"
      });
    }
  }

  async function createScopedSession() {
    setSessionState({ status: "creating" });
    setCopyState("idle");
    setManualCopyText("");

    try {
      const response = await fetch("/api/agent/sessions", {
        method: "POST"
      });
      const body = await response.json();

      if (!response.ok) {
        const message = typeof body?.message === "string"
          ? body.message
          : "Unable to create a scoped agent session.";
        setSessionState({ status: "error", message });
        captureAnalyticsEvent("agent session created", {
          action_count: 0,
          lane: AGENT_ACCESS_LANE,
          result: response.status === 401 ? "locked" : "error",
          tool_count: 0
        });
        return;
      }

      const session = body as AgentSessionResponse;
      setSessionState({ status: "ready", session });
      captureAnalyticsEvent("agent session created", {
        action_count: session.actions.length,
        lane: AGENT_ACCESS_LANE,
        result: "created",
        tool_count: session.tools.length
      });
    } catch {
      setSessionState({
        status: "error",
        message: "Unable to reach the agent session endpoint."
      });
      captureAnalyticsEvent("agent session created", {
        action_count: 0,
        lane: AGENT_ACCESS_LANE,
        result: "error",
        tool_count: 0
      });
    }
  }

  return (
    <>
      <button
        className="agent-access-trigger"
        onClick={openDialog}
        ref={triggerRef}
        type="button"
      >
        AI Agent
      </button>

      {isOpen ? (
        <div className="agent-access-backdrop" onClick={() => closeDialog("backdrop")}>
          <div
            aria-describedby="agent-access-description"
            aria-labelledby="agent-access-title"
            aria-modal="true"
            className="agent-access-card"
            onClick={(event) => event.stopPropagation()}
            ref={dialogRef}
            role="dialog"
          >
            <div className="agent-access-head">
              <div>
                <div className="label">Agent handoff</div>
                <h1 id="agent-access-title">AI Agent Mode</h1>
                <p id="agent-access-description">
                  Copy the scoped MCP config into Claude, Codex, OpenClaw, Cursor, or any MCP-capable agent. The docs explain the available tools and guarded YC OS action.
                </p>
              </div>
              <button
                aria-label="Close agent access dialog"
                className="note-btn"
                onClick={() => closeDialog("button")}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="agent-access-layout minimal">
              <section className="agent-access-panel">
                <div className="label">Claude / Codex / OpenClaw</div>
                <h2>MCP config for your agent</h2>
                <p>
                  Give this config to the user&apos;s AI agent. It can inspect YC OS through scoped MCP tools and use the guarded YC OS action when the operator asks it to.
                </p>

                <div className="agent-session-panel">
                  <div>
                    <span>Agent handoff</span>
                    <strong>
                      {sessionState.status === "ready"
                        ? "Agent handoff ready"
                        : sessionState.status === "creating"
                          ? "Loading agent handoff"
                          : sessionState.status === "error"
                            ? "Agent handoff unavailable"
                            : "Agent handoff loads on open"}
                    </strong>
                    <p>
                      Loaded automatically after the site unlock: scoped MCP app reads and guarded YC OS write tools.
                    </p>
                  </div>
                  <div className="agent-session-actions">
                    {sessionState.status === "ready" ? (
                      <button
                        className="note-btn primary"
                        onClick={() => copyText(activeSessionText, "config-copied", "mcp_config")}
                        type="button"
                      >
                        Copy MCP config
                      </button>
                    ) : null}
                    <button
                      className={sessionState.status === "ready" ? "note-btn" : "note-btn primary"}
                      disabled={sessionState.status === "creating"}
                      onClick={createScopedSession}
                      type="button"
                    >
                      {sessionState.status === "creating"
                        ? "Loading"
                        : sessionState.status === "ready"
                          ? "Refresh"
                          : sessionState.status === "error"
                            ? "Retry"
                            : "Load MCP config"}
                    </button>
                    <a className="note-btn" href="/approvals/integrations#ai-agent-docs">
                      Open docs
                    </a>
                  </div>
                  {sessionState.status === "error" ? (
                    <p className="agent-session-error">{sessionState.message}</p>
                  ) : null}
                  {sessionState.status === "ready" ? (
                    <div className="agent-session-config">
                      <label className="agent-brief-wrap compact">
                        <span>MCP config for external agent</span>
                        <textarea
                          className="agent-brief agent-config ph-no-capture"
                          readOnly
                          value={activeSessionText}
                        />
                      </label>
                    </div>
                  ) : null}
                </div>

                <div className="agent-access-actions">
                  <span className={`agent-copy-status ${copyState}`}>
                    {copyState === "manual"
                      ? "Clipboard blocked. Manual copy text is selected."
                      : copyState === "config-copied"
                        ? "MCP config copied. Paste it into the user's AI agent."
                        : "The config uses the same token as the unlocked site."}
                  </span>
                </div>

                {manualCopyText ? (
                  <label className="agent-manual-copy-wrap">
                    <span>Manual copy</span>
                    <textarea
                      className="agent-manual-copy ph-no-capture"
                      readOnly
                      ref={manualCopyRef}
                      value={manualCopyText}
                    />
                  </label>
                ) : null}
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
