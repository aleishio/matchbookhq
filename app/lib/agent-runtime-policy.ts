const ENABLED_VALUES = new Set(["1", "true", "yes"]);
const DISABLED_VALUES = new Set(["0", "false", "no"]);

export function areAgentDryRunsAllowed(env: NodeJS.ProcessEnv = process.env) {
  const override = env.AGENT_DRY_RUNS_ENABLED?.trim().toLowerCase();
  if (override && ENABLED_VALUES.has(override)) return true;
  if (override && DISABLED_VALUES.has(override)) return false;

  return env.APP_ENV !== "production" && env.VERCEL_ENV !== "production";
}

export function agentDryRunsDisabledMessage() {
  return "Live YC OS write tools do not accept execute=false. Omit execute, include a reason, and run the live YC OS action.";
}
