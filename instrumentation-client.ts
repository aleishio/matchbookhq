import posthog from "posthog-js";

import { isPostHogProjectTokenConfigured } from "./lib/analytics";

const DEFAULT_POSTHOG_PROXY_HOST = "/matchbook-relay";
const DEFAULT_POSTHOG_UI_HOST = "https://us.posthog.com";

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();
const enabled = process.env.NEXT_PUBLIC_POSTHOG_ENABLED === "true" && isPostHogProjectTokenConfigured(token);

if (enabled && token) {
  const posthogClient = posthog as typeof posthog & { __ycOsPostHogLoaded?: boolean };

  if (!posthogClient.__ycOsPostHogLoaded) {
    posthog.init(token, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || DEFAULT_POSTHOG_PROXY_HOST,
      autocapture: false,
      capture_dead_clicks: false,
      capture_pageleave: true,
      capture_pageview: "history_change",
      defaults: "2026-01-30",
      disable_session_recording: process.env.NEXT_PUBLIC_POSTHOG_RECORDINGS_ENABLED !== "true",
      mask_all_element_attributes: true,
      person_profiles: "identified_only",
      session_recording: {
        maskAllInputs: true,
        maskCapturedNetworkRequestFn: (request) => {
          if (request.name) {
            request.name = request.name.split("?")[0] ?? request.name;
          }

          return request;
        },
        maskTextSelector: ".ph-no-capture, .analytics-private"
      },
      ui_host: process.env.NEXT_PUBLIC_POSTHOG_UI_HOST || DEFAULT_POSTHOG_UI_HOST
    });
    posthogClient.__ycOsPostHogLoaded = true;
  }
}
