export type EnvOverrides = Record<string, string | undefined>;

export function withTestEnv(overrides: EnvOverrides) {
  const previous: EnvOverrides = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]])
  );

  for (const [key, value] of Object.entries(overrides)) {
    setEnv(key, value);
  }

  return {
    restore() {
      for (const [key, value] of Object.entries(previous)) {
        setEnv(key, value);
      }
    }
  };
}

export function withAgentEnv(
  overrides: EnvOverrides = {},
  options: { localEventApprovals?: boolean } = {}
) {
  const env: EnvOverrides = {
    AGENT_ACCESS_TOKEN: overrides.AGENT_ACCESS_TOKEN,
    YC_OS_ACCESS_TOKEN: overrides.YC_OS_ACCESS_TOKEN ?? "test-access-token"
  };

  if ("YC_OS_UNLOCK_COOKIE_NAME" in overrides) {
    env.YC_OS_UNLOCK_COOKIE_NAME = overrides.YC_OS_UNLOCK_COOKIE_NAME;
  }

  if (options.localEventApprovals) {
    env.EVENT_APPROVALS_DATA_SOURCE = "local";
    env.NEXT_PUBLIC_POSTHOG_ENABLED = "false";
  }

  return withTestEnv(env);
}

export function withSiteEnv(overrides: EnvOverrides) {
  return withTestEnv({
    AGENT_ACCESS_TOKEN: overrides.AGENT_ACCESS_TOKEN,
    YC_OS_ACCESS_TOKEN: overrides.YC_OS_ACCESS_TOKEN,
    YC_OS_UNLOCK_COOKIE_NAME: overrides.YC_OS_UNLOCK_COOKIE_NAME
  });
}

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}
