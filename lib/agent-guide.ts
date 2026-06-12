export type AgentGuide = {
  capacityLimit: {
    safeguards: string[];
    steps: string[];
    title: string;
  };
  dataLabels: string[];
  developmentLimits: {
    title: string;
    steps: string[];
    safeguards: string[];
  };
  firstTask: string[];
  operatorReport: string[];
  overview: string;
  safety: string[];
  smokeTest: {
    safeguards: string[];
    steps: string[];
    title: string;
    when: string;
  };
};

export const AGENT_GUIDE: AgentGuide = {
  overview: "YC OS lets authorized agents and YC team operators create events, add YC founder/company attendance, enrich events with YC notes and needs, review event prep, inspect approval queues, and run guarded YC OS write actions.",
  firstTask: [
    "Call get_agent_guide, or call the capabilities endpoint if MCP tools are not available yet.",
    "Call list_approval_events and inspect kind and guestAdds before choosing any event.",
    "Call get_event_prep_context with pageSize=5 to sample founder/event-prep context.",
    "Call list_approval_queue with the most relevant eventId and pageSize=5 if approval events exist.",
    "Explain which tools can execute the requested workflow end to end through YC OS, including create_event, add_event_attendees, enrich_event_context, add_event_guests, approve_applications, reject_applications, and request_application_info.",
    "Return a short operator report with the safest next action. Continue with live writes when the current instruction grants them; production rejects execute=false."
  ],
  operatorReport: [
    "What YC OS is for.",
    "Which read tools and guarded write actions are available, including which tools can trigger YC OS-owned provider effects.",
    "Which approval events are unlocked, and whether each sample is real/available or demo/dry_run_only.",
    "A small event-prep sample and approval-queue sample, with fake/test/demo rows clearly labelled if any appear.",
    "Recommended next action and whether the current handoff or instruction already grants permission to execute it."
  ],
  dataLabels: [
    "Real case: prefer events returned by list_approval_events with kind=real and guestAdds=available.",
    "Demo/fallback data: clearly label rows or events with kind=demo, guestAdds=dry_run_only, or source says fallback, demo, synthetic, test, or example.",
    "Fake/demo YC OS data is for reading, overview, and prompt validation only; it is not a separate live event destination where agents can add real people.",
    "Fake/test guests in a real event are only useful when the operator confirms they are test records that can be cleared or reused.",
    "Fake/test guests: only treat a guest as removable test data when the operator confirms it is fake/test data; never infer that from a name alone.",
    "If only demo/fallback data is available, give the overview but do not execute event writes."
  ],
  smokeTest: {
    title: "Safest real test: operator-email live guest add",
    when: "Use this when a YC team user wants to verify the whole agent flow with their own email.",
    steps: [
      "Ask the operator for the event to test and their email address; never infer or reuse an email from queue data.",
      "Call list_approval_events and pick an event with kind=real and guestAdds=available; do not use demo/fallback or dry_run_only events for execution.",
      "Confirm the selected eventId, event title, and operator-provided email with the operator.",
      "Call add_event_guests with sendEmail=false, approvalStatus=approved, reason, and one guest using the operator-provided email.",
      "Show the live result to the operator, including event title, requestedCount, mode, request status, sendEmail, and guest emailDomain only.",
      "Keep sendEmail=false unless the operator asks otherwise, and summarize the result without public logs."
    ],
    safeguards: [
      "Write tools are live by default and require a reason before writing.",
      "The smoke test uses one operator-provided email, not applicant data.",
      "Production rejects execute=false; use a real event and a reason when the operator asks for a write.",
      "Real execution requires a reason.",
      "sendEmail defaults to false so the test does not send provider email by accident.",
      "Never put tokens, raw payloads, names, emails, phones, or reasons into public logs or PR text."
    ]
  },
  capacityLimit: {
    title: "If the real event is at the provider add limit",
    steps: [
      "Do not switch to demo data just to make the test pass; report that the real event appears full or blocked by provider limits.",
      "Ask the operator whether there are 2-3 clearly fake/test guests that can be removed or declined in the provider dashboard to make room.",
      "Do not remove or decline anyone through the agent unless a dedicated guarded removal action exists and the operator identifies the exact fake/test guests.",
      "After the operator clears fake/test guests outside the agent, ask them to sync or refresh YC OS, then rerun the one-email live test.",
      "If no fake/test guests are available to clear, stop and ask the operator for a different real test event."
    ],
    safeguards: [
      "Never remove real attendees to make room for a test.",
      "Never guess which guests are fake; require explicit operator confirmation.",
      "Keep the smoke test to one operator-provided email.",
      "If execution fails because of capacity or provider limits, summarize the failure and stop before retrying."
    ]
  },
  developmentLimits: {
    title: "Development provider API limits",
    steps: [
      "Assume this development environment may be blocked by provider verification, rate limits, or event capacity until the operator says production provider access is verified.",
      "Reads, MCP tool discovery, and approval queue review are valid non-mutating checks of the YC OS agent workflow.",
      "If a live write returns a provider error such as 429, 403, 409, or another provider rejection, summarize the status and stop; do not retry in a loop.",
      "Do not ask for provider secrets or try to bypass verification/rate limits.",
      "After provider verification or capacity cleanup, rerun the same one-guest live test with a reason."
    ],
    safeguards: [
      "Team members and agents should treat live writes as the only production acceptance test.",
      "A failed real add in development does not mean the MCP tools are broken if event lookup and queue reads worked.",
      "Never switch from a blocked real event to fake/demo data and claim that a real event add succeeded."
    ]
  },
  safety: [
    "Use MCP/API tools only; do not browse the YC OS website.",
    "Use YC OS tool names such as create_event, add_event_attendees, enrich_event_context, add_event_guests, get_guest_context, approve_applications, reject_applications, and request_application_info; do not ask for provider endpoints.",
    "Use get_guest_context for the private operator view of one applicant: contact fields, registration answers, evidence, email/reply logs, AI review state, and provider writeback status.",
    "When request_application_info is executed in Supabase production, YC OS should attempt scoped immediate Resend delivery and return runtime status; if it cannot, report the queued or failed runtime state.",
    "Treat YC OS MCP tools as the agent-native operating surface. The server-side runtime owns secrets, raw payloads, provider calls, idempotency, retries, and audit.",
    "Write tools are live by default in production. Omit execute or set execute=true, and include a reason.",
    "Do not request server shell, database console, repo write, deployment, or secrets access.",
    "Keep write payloads small: at most 10 guests per request, and one guest for the smoke test.",
    "Report localhost/network failures instead of switching to UI exploration."
  ]
};
