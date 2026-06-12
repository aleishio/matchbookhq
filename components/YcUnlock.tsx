"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatAgentHandoffText, type AgentHandoffSession } from "@/lib/agent-handoff";
import { captureAnalyticsEvent } from "@/lib/analytics";

type UnlockMode = "app" | "agent";
type InstructionAudience = "human" | "machine";

type AgentSessionResponse = AgentHandoffSession & {
  authorizationHeader: string;
  tokenLabel: "site_access_token";
};

type UnlockState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string }
  | { status: "agent-ready"; session: AgentSessionResponse };

type YcUnlockProps = {
  defaultMode?: UnlockMode;
  nextPath: string;
  showAgentInstructions?: boolean;
};

export function YcUnlock({
  defaultMode = "app",
  nextPath,
  showAgentInstructions = false
}: YcUnlockProps) {
  const [mode, setMode] = useState<UnlockMode>(defaultMode);
  const [instructionAudience, setInstructionAudience] = useState<InstructionAudience>(
    defaultMode === "agent" ? "machine" : "human"
  );
  const [password, setPassword] = useState("");
  const [state, setState] = useState<UnlockState>({ status: "idle" });
  const [copyState, setCopyState] = useState<"idle" | "copied" | "machine-copied" | "manual">("idle");
  const hasCapturedAgentOpenRef = useRef(false);
  const manualCopyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const hashToken = getHashToken(window.location.hash);
    if (!hashToken) return;

    setPassword(hashToken);
  }, []);

  const agentConfigText = useMemo(() => {
    if (state.status !== "agent-ready") return "";

    return formatAgentHandoffText(state.session);
  }, [state]);

  const machineInstructions = useMemo(() => formatMachineInstructions(), []);

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
    await unlockWithCredentials({
      nextMode: mode,
      nextPassword: password
    });
  }

  async function unlockWithCredentials({
    nextMode,
    nextPassword
  }: {
    nextMode: UnlockMode;
    nextPassword: string;
  }) {
    setState({ status: "submitting" });
    setCopyState("idle");

    let response: Response;
    let body: Record<string, unknown>;
    try {
      response = await fetch("/api/unlock", {
        body: JSON.stringify({
          mode: nextMode,
          next: nextPath,
          password: nextPassword
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

    if (nextMode === "agent") {
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

  async function copyMachineInstructions() {
    try {
      await navigator.clipboard.writeText(machineInstructions);
      setCopyState("machine-copied");
    } catch {
      setCopyState("manual");
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
    <main className={`unlock-page${showAgentInstructions ? " agent-unlock-page" : ""}`}>
      <section className={`unlock-panel${showAgentInstructions ? " agent-unlock-panel" : ""}`} aria-labelledby="unlock-title">
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
                <span>Human</span>
                <strong>Open app</strong>
              </button>
              <button
                aria-pressed={mode === "agent"}
                className={`unlock-mode${mode === "agent" ? " active" : ""}`}
                onClick={() => selectMode("agent")}
                type="button"
              >
                <span>Machine</span>
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
                  ? "Unlock machine handoff"
                  : "Unlock YC OS"}
            </button>
          </form>
        )}

        {showAgentInstructions && state.status !== "agent-ready" ? (
          <section className="unlock-agent-instructions" aria-label="Agent instructions">
            <div className="agent-instruction-header">
              <div>
                <div className="label">Agent handoff</div>
                <h2>Agent-native unlock instructions.</h2>
              </div>
              <div className="agent-audience-toggle" aria-label="Instruction audience">
                <button
                  aria-pressed={instructionAudience === "human"}
                  className={instructionAudience === "human" ? "active" : ""}
                  onClick={() => setInstructionAudience("human")}
                  type="button"
                >
                  Human
                </button>
                <button
                  aria-pressed={instructionAudience === "machine"}
                  className={instructionAudience === "machine" ? "active" : ""}
                  onClick={() => setInstructionAudience("machine")}
                  type="button"
                >
                  Machine
                </button>
              </div>
            </div>
            {instructionAudience === "human" ? (
              <>
                <ol>
                  <li>Use Human to open the app, or Machine to generate an agent handoff.</li>
                  <li>Shared links can use <code>/u#&lt;site-token&gt;</code>. The hash prefills the password field, but does not choose a mode.</li>
                  <li>For agents, choose Machine and unlock. The visible plaintext handoff includes the MCP URL, bearer token, tools, and rules.</li>
                  <li>Direct API flow starts with <code>GET /api/agent/capabilities</code>, then <code>/api/mcp</code> or <code>/api/agent/tools/call</code>.</li>
                </ol>
                <p>
                  Do not provide .env files, service-role keys, provider payloads, shell, database,
                  GitHub, or deployment access.
                </p>
              </>
            ) : (
              <>
                <pre className="agent-machine-instructions ph-no-capture">{machineInstructions}</pre>
                <div className="unlock-actions">
                  <button className="note-btn" onClick={copyMachineInstructions} type="button">
                    Copy machine instructions
                  </button>
                  <span className={`unlock-copy-status ${copyState}`}>
                    {copyState === "machine-copied"
                      ? "Copied."
                      : copyState === "manual"
                        ? "Clipboard blocked. Select the plaintext block manually."
                        : "No bearer token is printed here until unlock succeeds."}
                  </span>
                </div>
              </>
            )}
          </section>
        ) : null}

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

function getHashToken(hash: string) {
  const rawHash = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!rawHash.trim()) return "";

  const decodedHash = decodePasscodeHash(rawHash.trim());
  const hashParams = new URLSearchParams(decodedHash);
  return hashParams.get("token")
    ?? hashParams.get("access_token")
    ?? decodedHash;
}

function formatMachineInstructions() {
  return `YC_OS_AGENT_LAUNCH
origin=https://www.matchbookhq.com
open=https://www.matchbookhq.com/u#<site-token>
hash=Use window.location.hash without "#"; this prefills the password field.
flow=Choose Machine, submit unlock, then read/copy "YC OS MCP agent handoff".
fallback=If locked or no hash exists, ask for site token or copied handoff.
api=GET https://www.matchbookhq.com/api/agent/capabilities with Authorization: Bearer <site-token>; then /api/mcp or POST /api/agent/tools/call.
read_first=get_agent_guide; list_approval_events -> eventId; get_event_prep_context(eventId,pageSize=5); list_approval_queue(eventId,pageSize=5) -> applicationId; get_approval_summary(applicationId).
writes=live. Use returned actions only. reason required. sendEmail=false unless asked. max 10 guests.
never=.env,service-role keys,provider payloads,shell,DB,GitHub,deploy access,public token logs.
report=page URL,event id/filter,tool/action,result,next decision.`;
}
