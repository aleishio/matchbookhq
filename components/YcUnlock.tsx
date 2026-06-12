"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatAgentHandoffText, type AgentHandoffSession } from "@/lib/agent-handoff";
import { captureAnalyticsEvent } from "@/lib/analytics";

type UnlockMode = "app" | "agent";

type AgentSessionResponse = AgentHandoffSession & {
  authorizationHeader: string;
  tokenLabel: "site_access_token";
};

type UnlockState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string }
  | { status: "agent-ready"; session: AgentSessionResponse };

export function YcUnlock({ nextPath }: { nextPath: string }) {
  const [mode, setMode] = useState<UnlockMode>("app");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<UnlockState>({ status: "idle" });
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");
  const hasCapturedAgentOpenRef = useRef(false);
  const manualCopyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;

    setPassword(decodePasscodeHash(hash.slice(1)));
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`
    );
  }, []);

  const agentConfigText = useMemo(() => {
    if (state.status !== "agent-ready") return "";

    return formatAgentHandoffText(state.session);
  }, [state]);

  useEffect(() => {
    if (copyState !== "manual") return;
    const timer = window.setTimeout(() => {
      manualCopyRef.current?.focus();
      manualCopyRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  async function submitUnlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ status: "submitting" });
    setCopyState("idle");

    let response: Response;
    let body: Record<string, unknown>;
    try {
      response = await fetch("/api/unlock", {
        body: JSON.stringify({
          mode,
          next: nextPath,
          password
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      body = await response.json().catch(() => ({}));
    } catch {
      setState({
        status: "error",
        message: "Unable to reach the YC OS unlock endpoint."
      });
      return;
    }

    if (!response.ok) {
      setState({
        status: "error",
        message: typeof body?.message === "string" ? body.message : "Unable to unlock YC OS."
      });
      return;
    }

    if (mode === "agent") {
      await createAgentSession();
      return;
    }

    window.location.assign(typeof body?.next === "string" ? body.next : nextPath);
  }

  async function createAgentSession() {
    let response: Response;
    let body: Record<string, unknown>;
    try {
      response = await fetch("/api/agent/sessions", {
        method: "POST"
      });
      body = await response.json().catch(() => ({}));
    } catch {
      setState({
        status: "error",
        message: "Unable to reach the scoped agent endpoint."
      });
      captureAnalyticsEvent("agent session created", {
        action_count: 0,
        lane: "cowork",
        result: "error",
        tool_count: 0
      });
      return;
    }

    if (!response.ok) {
      setState({
        status: "error",
        message: typeof body?.message === "string"
          ? body.message
          : "YC OS unlocked, but the scoped agent endpoint was not created."
      });
      captureAnalyticsEvent("agent session created", {
        action_count: 0,
        lane: "cowork",
        result: response.status === 401 ? "locked" : "error",
        tool_count: 0
      });
      return;
    }

    const session = body as AgentSessionResponse;
    setState({
      session,
      status: "agent-ready"
    });
    captureAnalyticsEvent("agent session created", {
      action_count: session.actions?.length ?? 0,
      lane: "cowork",
      result: "created",
      tool_count: session.tools?.length ?? 0
    });
  }

  async function copyAgentConfig() {
    if (!agentConfigText) return;

    try {
      await navigator.clipboard.writeText(agentConfigText);
      setCopyState("copied");
      captureAnalyticsEvent("agent handoff copied", {
        content_type: "mcp_config",
        lane: "cowork",
        result: "copied"
      });
    } catch {
      setCopyState("manual");
      captureAnalyticsEvent("agent handoff copied", {
        content_type: "mcp_config",
        lane: "cowork",
        result: "manual_fallback"
      });
    }
  }

  function selectMode(nextMode: UnlockMode) {
    setMode(nextMode);

    if (nextMode !== "agent") return;
    if (!hasCapturedAgentOpenRef.current) {
      hasCapturedAgentOpenRef.current = true;
      captureAnalyticsEvent("agent access opened", {
        default_lane: "cowork",
        entrypoint: "unlock_page"
      });
    }
    captureAnalyticsEvent("agent access lane selected", {
      lane: "cowork"
    });
  }

  return (
    <main className="unlock-page">
      <section className="unlock-panel" aria-labelledby="unlock-title">
        <div className="unlock-brand-row">
          <div className="yc-mark large" aria-hidden="true">Y</div>
          <div>
            <div className="label">Private access</div>
            <h1 id="unlock-title">YC OS</h1>
          </div>
        </div>

        {state.status === "agent-ready" ? null : (
          <form className="unlock-form" onSubmit={submitUnlock}>
            <div className="unlock-mode-group" aria-label="Unlock mode">
              <button
                aria-pressed={mode === "app"}
                className={`unlock-mode${mode === "app" ? " active" : ""}`}
                onClick={() => selectMode("app")}
                type="button"
              >
                <span>Open app</span>
                <strong>Human review</strong>
              </button>
              <button
                aria-pressed={mode === "agent"}
                className={`unlock-mode${mode === "agent" ? " active" : ""}`}
                onClick={() => selectMode("agent")}
                type="button"
              >
                <span>Agent mode</span>
                <strong>Agent handoff</strong>
              </button>
            </div>

            <label className="unlock-field">
              <span>Password</span>
              <input
                autoComplete="current-password"
                autoFocus
                className="unlock-input"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter YC access password"
                type="password"
                value={password}
              />
            </label>

            {state.status === "error" ? (
              <p className="unlock-error" role="alert">{state.message}</p>
            ) : null}

            <button
              className="unlock-submit"
              disabled={state.status === "submitting" || password.trim().length === 0}
              type="submit"
            >
              {state.status === "submitting"
                ? "Unlocking"
                : mode === "agent"
                  ? "Unlock agent mode"
                  : "Unlock YC OS"}
            </button>
          </form>
        )}

        {state.status === "agent-ready" ? (
          <section className="unlock-agent-ready" aria-live="polite">
            <div>
              <div className="label">Scoped endpoint ready</div>
              <h2>Agent mode is unlocked</h2>
              <p>
                Copy this handoff prompt into your agent. It already includes the unlock token,
                MCP endpoint, and allowed tools.
              </p>
            </div>
            <textarea
              className="unlock-agent-config ph-no-capture"
              readOnly
              ref={manualCopyRef}
              value={agentConfigText}
            />
            <div className="unlock-actions">
              <button className="note-btn primary" onClick={copyAgentConfig} type="button">
                Copy agent handoff
              </button>
              <a className="note-btn" href="/approvals/integrations#ai-agent-docs">
                Open docs
              </a>
              <a className="note-btn" href={nextPath}>
                Continue to app
              </a>
            </div>
            <p className={`unlock-copy-status ${copyState}`}>
              {copyState === "copied"
                ? "Copied. Your agent now has the scoped YC OS prompt and token it needs."
                : copyState === "manual"
                  ? "Clipboard blocked. The full agent handoff prompt is selected for manual copy."
                  : "The handoff does not grant server shell, database console, deployment access, or secrets."}
            </p>
          </section>
        ) : (
          <div className="unlock-foot">
            <span>Authorized YC team only</span>
            <span>Same password unlocks app and agent handoff</span>
          </div>
        )}
      </section>
    </main>
  );
}

function decodePasscodeHash(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
