import assert from "node:assert/strict";
import test from "node:test";

import {
  scoreFounderPair,
  suggestIntrosForFounder,
  type FounderForMatching,
} from "../lib/matching.ts";

const founders: FounderForMatching[] = [
  {
    id: "f-ai-evals",
    name: "Anika",
    company_id: "c-evals",
    company_name: "EvalPilot",
    category: "AI Infra",
    stage: "Seed",
    need_text: "Needs design partners for LLM evals and model quality workflows.",
    one_liner: "AI infrastructure for evaluating agent reliability.",
  },
  {
    id: "f-ai-observe",
    name: "Ben",
    company_id: "c-observe",
    company_name: "TraceLayer",
    category: "Developer Tools",
    stage: "Seed",
    need_text: "Looking for design partners around AI evals, benchmarks, and observability.",
    one_liner: "LLM observability for production AI agents.",
  },
  {
    id: "f-health-gtm",
    name: "Carla",
    company_id: "c-health",
    company_name: "ClinicFlow",
    category: "Healthcare",
    stage: "Series A",
    need_text: "Wants GTM help with enterprise sales into clinics and providers.",
    one_liner: "Workflow automation for healthcare operations.",
  },
  {
    id: "f-same-company",
    name: "Dev",
    company_id: "c-evals",
    company_name: "EvalPilot",
    category: "AI Infra",
    stage: "Seed",
    need_text: "Working on sales pipeline for the same evals product.",
    one_liner: "AI infrastructure for evaluating agent reliability.",
  },
  {
    id: "f-consumer",
    name: "Eli",
    company_id: "c-consumer",
    company_name: "Picnic",
    category: "Consumer",
    stage: "Seed",
    need_text: "Needs launch feedback for a social photo app.",
    one_liner: "Consumer app for weekend planning.",
  },
];

test("scores strong matches from category, need, workflow, and AI eval overlap", () => {
  const suggestion = scoreFounderPair(founders[0], founders[1]);

  assert.ok(suggestion);
  assert.equal(suggestion.fit_label, "strong");
  assert.equal(suggestion.caution, null);
  assert.match(suggestion.reason, /ai evals/i);
  assert.match(suggestion.opener, /Anika/);
  assert.match(suggestion.opener, /Ben/);
  assert.ok(
    suggestion.evidence.some((item) => item.kind === "ai_infra"),
    "expected AI infra/evals evidence",
  );
});

test("same-company pairs are context with a caution, not a normal intro", () => {
  const suggestion = scoreFounderPair(founders[0], founders[3]);

  assert.ok(suggestion);
  assert.equal(suggestion.fit_label, "check");
  assert.match(String(suggestion.caution), /same company/i);
  assert.match(suggestion.opener, /Not a new intro/);
  assert.ok(
    suggestion.evidence.some((item) => item.kind === "caution"),
    "expected caution evidence",
  );
});

test("same-company context can be excluded", () => {
  const suggestion = scoreFounderPair(founders[0], founders[3], {
    include_same_company_context: false,
  });

  assert.equal(suggestion, null);
});

test("weak category and workflow mismatch is labelled check with caution", () => {
  const suggestion = scoreFounderPair(founders[2], founders[4]);

  assert.ok(suggestion);
  assert.equal(suggestion.fit_label, "check");
  assert.match(
    String(suggestion.caution),
    /categories do not obviously align|weak deterministic match/i,
  );
});

test("suggestions are deterministic and prioritize stronger fits before cautions", () => {
  const first = suggestIntrosForFounder("f-ai-evals", founders, {
    max_suggestions_per_founder: 4,
  });
  const second = suggestIntrosForFounder("f-ai-evals", founders, {
    max_suggestions_per_founder: 4,
  });

  assert.deepEqual(first, second);
  assert.equal(first[0].to_founder_id, "f-ai-observe");
  assert.equal(first[0].fit_label, "strong");
  assert.ok(
    first.findIndex((item) => item.fit_label === "strong") <
      first.findIndex((item) => item.fit_label === "check"),
    "expected strong suggestions before check suggestions",
  );
  assert.ok(
    first.some(
      (item) => item.to_founder_id === "f-consumer" && item.fit_label === "check",
    ),
    "expected weak consumer match to remain a check suggestion",
  );
});
