export type FitLabel = "strong" | "good" | "check";

export type FounderForMatching = {
  id: string;
  name: string;
  company_id?: string | null;
  company_name?: string | null;
  role?: string | null;
  location?: string | null;
  batch?: string | null;
  stage?: string | null;
  category?: string | null;
  one_liner?: string | null;
  website?: string | null;
  yc_url?: string | null;
  need_text?: string | null;
  ask?: string | null;
  tags?: string[] | null;
  keywords?: string[] | null;
  gtm_motion?: string | null;
  workflow?: string | null;
};

export type IntroEvidenceKind =
  | "category"
  | "need_keyword"
  | "workflow"
  | "ai_infra"
  | "text_overlap"
  | "caution";

export type IntroEvidence = {
  kind: IntroEvidenceKind;
  label: string;
  detail: string;
  weight: number;
};

export type IntroSuggestion = {
  from_founder_id: string;
  to_founder_id: string;
  fit_label: FitLabel;
  reason: string;
  opener: string;
  caution: string | null;
  evidence: IntroEvidence[];
};

export type MatchingOptions = {
  max_suggestions_per_founder?: number;
  include_same_company_context?: boolean;
  include_check_suggestions?: boolean;
};

type WeightedEvidence = IntroEvidence & {
  score: number;
};

type SignalSet = {
  text: string;
  category: string;
  needClusters: Set<string>;
  workflowClusters: Set<string>;
  aiInfra: boolean;
  aiEvals: boolean;
  tokens: Set<string>;
};

const DEFAULT_MAX_SUGGESTIONS_PER_FOUNDER = 3;
const SIGNAL_CACHE = new WeakMap<FounderForMatching, SignalSet>();

const NEED_KEYWORDS: Record<string, string[]> = {
  fundraising: [
    "fundraising",
    "fundraise",
    "raise",
    "raising",
    "investor",
    "investors",
    "capital",
    "seed",
    "series a",
    "runway",
  ],
  "design partners": [
    "design partner",
    "design partners",
    "pilot",
    "pilots",
    "beta",
    "early customer",
    "early customers",
    "lighthouse customer",
    "customer discovery",
  ],
  gtm: [
    "gtm",
    "go to market",
    "go-to-market",
    "sales",
    "pipeline",
    "outbound",
    "demand gen",
    "distribution",
    "partnership",
    "partnerships",
    "enterprise sales",
  ],
  "ai evals": [
    "eval",
    "evals",
    "evaluation",
    "evaluations",
    "benchmark",
    "benchmarks",
    "hallucination",
    "guardrail",
    "guardrails",
    "observability",
    "llm eval",
    "model quality",
  ],
  "hardware sales cycle": [
    "hardware",
    "manufacturing",
    "supply chain",
    "procurement",
    "medical device",
    "robotics",
    "sales cycle",
    "channel sales",
  ],
};

const WORKFLOW_KEYWORDS: Record<string, string[]> = {
  gtm: ["gtm", "sales", "pipeline", "crm", "outbound", "revops", "customer success"],
  recruiting: ["recruiting", "hiring", "talent", "interview", "candidate", "workforce"],
  healthcare: ["healthcare", "clinical", "clinic", "patient", "provider", "payer", "medical"],
  devtools: ["developer", "devtools", "api", "sdk", "infrastructure", "observability"],
  security: ["security", "compliance", "soc 2", "risk", "audit", "identity"],
  finance: ["finance", "fintech", "accounting", "payments", "billing", "invoice"],
  education: ["education", "learning", "school", "student", "teacher", "training"],
  logistics: ["logistics", "supply chain", "warehouse", "shipping", "freight", "fleet"],
  support: ["support", "customer support", "ticket", "call center", "helpdesk"],
  analytics: ["analytics", "data", "warehouse", "bi", "metrics", "insight"],
};

const AI_INFRA_TERMS = [
  "ai infra",
  "ai infrastructure",
  "llm",
  "llms",
  "rag",
  "retrieval",
  "agent",
  "agents",
  "model",
  "models",
  "inference",
  "vector",
  "embedding",
  "embeddings",
  "gpu",
  "fine tune",
  "fine-tune",
];

const AI_EVAL_TERMS = NEED_KEYWORDS["ai evals"];

const CATEGORY_ALIASES: Record<string, string> = {
  "ai": "ai",
  "artificial intelligence": "ai",
  "machine learning": "ai",
  "ml": "ai",
  "ai infra": "ai infra",
  "ai infrastructure": "ai infra",
  "devtool": "devtools",
  "devtools": "devtools",
  "developer tools": "devtools",
  "infrastructure": "infrastructure",
  "data": "data",
  "analytics": "data",
  "b2b": "b2b saas",
  "b2b saas": "b2b saas",
  "saas": "b2b saas",
  "enterprise": "b2b saas",
  "productivity": "productivity",
  "healthcare": "healthcare",
  "health care": "healthcare",
  "healthtech": "healthcare",
  "bio": "bio",
  "biotech": "bio",
  "fintech": "fintech",
  "finance": "fintech",
  "accounting": "fintech",
  "payments": "fintech",
  "hardware": "hardware",
  "robotics": "robotics",
  "industrial": "industrial",
  "climate": "climate",
  "energy": "energy",
  "consumer": "consumer",
  "marketplace": "marketplace",
};

const ADJACENT_CATEGORIES: Record<string, string[]> = {
  ai: ["ai infra", "devtools", "infrastructure", "data"],
  "ai infra": ["ai", "devtools", "infrastructure", "data"],
  devtools: ["ai", "ai infra", "infrastructure", "data"],
  infrastructure: ["ai infra", "devtools", "data"],
  data: ["ai", "ai infra", "devtools", "infrastructure", "analytics"],
  "b2b saas": ["productivity", "devtools", "fintech"],
  productivity: ["b2b saas", "education"],
  healthcare: ["bio", "ai", "b2b saas"],
  bio: ["healthcare", "ai"],
  fintech: ["b2b saas", "data"],
  hardware: ["robotics", "industrial", "climate", "energy"],
  robotics: ["hardware", "industrial", "ai"],
  industrial: ["hardware", "robotics", "climate", "energy"],
  climate: ["energy", "industrial", "hardware"],
  energy: ["climate", "industrial", "hardware"],
  consumer: ["marketplace", "productivity"],
  marketplace: ["consumer", "b2b saas"],
};

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "co",
  "company",
  "for",
  "from",
  "help",
  "in",
  "into",
  "is",
  "it",
  "need",
  "needs",
  "of",
  "on",
  "or",
  "our",
  "startup",
  "that",
  "the",
  "their",
  "to",
  "us",
  "with",
]);

export function suggestIntros(
  founders: FounderForMatching[],
  options: MatchingOptions = {},
): IntroSuggestion[] {
  const maxPerFounder =
    options.max_suggestions_per_founder ?? DEFAULT_MAX_SUGGESTIONS_PER_FOUNDER;

  return founders.flatMap((founder) =>
    suggestIntrosForFounder(founder.id, founders, {
      ...options,
      max_suggestions_per_founder: maxPerFounder,
    }),
  );
}

export function suggestIntrosForFounder(
  founderId: string,
  founders: FounderForMatching[],
  options: MatchingOptions = {},
): IntroSuggestion[] {
  const from = founders.find((founder) => founder.id === founderId);

  if (!from) {
    return [];
  }

  const maxPerFounder =
    options.max_suggestions_per_founder ?? DEFAULT_MAX_SUGGESTIONS_PER_FOUNDER;

  return founders
    .filter((candidate) => candidate.id !== founderId)
    .map((candidate) => scoreFounderPairInternal(from, candidate, options))
    .filter((suggestion): suggestion is IntroSuggestion & { score: number } =>
      Boolean(suggestion),
    )
    .filter(
      (suggestion) =>
        options.include_check_suggestions !== false ||
        suggestion.fit_label !== "check" ||
        Boolean(suggestion.caution),
    )
    .sort(compareSuggestions)
    .slice(0, maxPerFounder)
    .map(({ score: _score, ...suggestion }) => suggestion);
}

export function scoreFounderPair(
  from: FounderForMatching,
  to: FounderForMatching,
  options: MatchingOptions = {},
): IntroSuggestion | null {
  const suggestion = scoreFounderPairInternal(from, to, options);

  if (!suggestion) {
    return null;
  }

  const { score: _score, ...publicSuggestion } = suggestion;

  return publicSuggestion;
}

function scoreFounderPairInternal(
  from: FounderForMatching,
  to: FounderForMatching,
  options: MatchingOptions = {},
): (IntroSuggestion & { score: number }) | null {
  const fromSignals = buildSignals(from);
  const toSignals = buildSignals(to);
  const sameCompany = isSameCompany(from, to);
  const evidence: WeightedEvidence[] = [];
  let score = 0;

  if (sameCompany) {
    if (options.include_same_company_context === false) {
      return null;
    }

    evidence.push({
      kind: "caution",
      label: "Same company",
      detail: "Use this as internal context, not a new intro.",
      weight: -60,
      score: -60,
    });
    score -= 60;
  }

  const categoryEvidence = scoreCategory(fromSignals.category, toSignals.category);
  if (categoryEvidence) {
    evidence.push(categoryEvidence);
    score += categoryEvidence.score;
  }

  const needEvidence = scoreSetOverlap(
    fromSignals.needClusters,
    toSignals.needClusters,
    "need_keyword",
    28,
    "Shared explicit need",
  );
  evidence.push(...needEvidence);
  score += sumEvidence(needEvidence);

  const workflowEvidence = scoreSetOverlap(
    fromSignals.workflowClusters,
    toSignals.workflowClusters,
    "workflow",
    20,
    "Shared workflow/GTM motion",
  );
  evidence.push(...workflowEvidence);
  score += sumEvidence(workflowEvidence);

  const aiEvidence = scoreAiOverlap(fromSignals, toSignals);
  evidence.push(...aiEvidence);
  score += sumEvidence(aiEvidence);

  const tokenEvidence = scoreTokenOverlap(fromSignals.tokens, toSignals.tokens);
  if (tokenEvidence) {
    evidence.push(tokenEvidence);
    score += tokenEvidence.score;
  }

  const positiveEvidence = evidence.filter((item) => item.score > 0);
  const mismatchCaution = getMismatchCaution({
    sameCompany,
    score,
    fromSignals,
    toSignals,
    positiveEvidence,
  });

  if (mismatchCaution) {
    evidence.push({
      kind: "caution",
      label: "Check fit",
      detail: mismatchCaution,
      weight: -12,
      score: -12,
    });
    score -= 12;
  }

  if (!sameCompany && score < 18 && options.include_check_suggestions === false) {
    return null;
  }

  const caution = sameCompany
    ? "Same company; use as context, not a new introduction."
    : mismatchCaution;
  const fit_label = getFitLabel(score, Boolean(caution));

  return {
    from_founder_id: from.id,
    to_founder_id: to.id,
    fit_label,
    reason: buildReason(from, to, positiveEvidence, caution),
    opener: buildOpener(from, to, positiveEvidence, sameCompany),
    caution,
    evidence: evidence
      .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
      .map(({ score: _score, ...item }) => item),
    score,
  };
}

function buildSignals(founder: FounderForMatching): SignalSet {
  const cached = SIGNAL_CACHE.get(founder);
  if (cached) return cached;

  const text = normalize(
    [
      founder.name,
      founder.company_name,
      founder.role,
      founder.location,
      founder.batch,
      founder.stage,
      founder.category,
      founder.one_liner,
      founder.need_text,
      founder.ask,
      founder.gtm_motion,
      founder.workflow,
      ...(founder.tags ?? []),
      ...(founder.keywords ?? []),
    ]
      .filter(Boolean)
      .join(" "),
  );

  const signals = {
    text,
    category: normalizeCategory(founder.category),
    needClusters: findClusters(text, NEED_KEYWORDS),
    workflowClusters: findClusters(text, WORKFLOW_KEYWORDS),
    aiInfra: includesAny(text, AI_INFRA_TERMS),
    aiEvals: includesAny(text, AI_EVAL_TERMS),
    tokens: tokenize(text),
  };
  SIGNAL_CACHE.set(founder, signals);
  return signals;
}

function scoreCategory(
  fromCategory: string,
  toCategory: string,
): WeightedEvidence | null {
  if (!fromCategory || !toCategory) {
    return null;
  }

  if (fromCategory === toCategory) {
    return {
      kind: "category",
      label: "Same category",
      detail: fromCategory,
      weight: 35,
      score: 35,
    };
  }

  if (ADJACENT_CATEGORIES[fromCategory]?.includes(toCategory)) {
    return {
      kind: "category",
      label: "Adjacent categories",
      detail: `${fromCategory} <> ${toCategory}`,
      weight: 18,
      score: 18,
    };
  }

  return null;
}

function scoreSetOverlap(
  fromSet: Set<string>,
  toSet: Set<string>,
  kind: IntroEvidenceKind,
  points: number,
  label: string,
): WeightedEvidence[] {
  return [...fromSet]
    .filter((value) => toSet.has(value))
    .sort()
    .map((value) => ({
      kind,
      label,
      detail: value,
      weight: points,
      score: points,
    }));
}

function scoreAiOverlap(
  fromSignals: SignalSet,
  toSignals: SignalSet,
): WeightedEvidence[] {
  const evidence: WeightedEvidence[] = [];

  if (fromSignals.aiInfra && toSignals.aiInfra) {
    evidence.push({
      kind: "ai_infra",
      label: "AI infra overlap",
      detail: "Both profiles mention AI infrastructure, LLMs, agents, or model systems.",
      weight: 18,
      score: 18,
    });
  }

  if (fromSignals.aiEvals && toSignals.aiEvals) {
    evidence.push({
      kind: "ai_infra",
      label: "AI evals overlap",
      detail: "Both profiles mention evals, benchmarks, observability, or model quality.",
      weight: 22,
      score: 22,
    });
  }

  return evidence;
}

function scoreTokenOverlap(
  fromTokens: Set<string>,
  toTokens: Set<string>,
): WeightedEvidence | null {
  const overlap = [...fromTokens]
    .filter((token) => toTokens.has(token))
    .sort()
    .slice(0, 5);

  if (overlap.length < 2) {
    return null;
  }

  const points = Math.min(14, overlap.length * 3);

  return {
    kind: "text_overlap",
    label: "Shared language",
    detail: overlap.join(", "),
    weight: points,
    score: points,
  };
}

function getMismatchCaution(input: {
  sameCompany: boolean;
  score: number;
  fromSignals: SignalSet;
  toSignals: SignalSet;
  positiveEvidence: WeightedEvidence[];
}): string | null {
  if (input.sameCompany) {
    return null;
  }

  const hasCategoryEvidence = input.positiveEvidence.some(
    (item) => item.kind === "category",
  );
  const hasNeedOrWorkflowEvidence = input.positiveEvidence.some(
    (item) => item.kind === "need_keyword" || item.kind === "workflow",
  );

  if (!hasCategoryEvidence && !hasNeedOrWorkflowEvidence) {
    return "Weak deterministic match; verify the ask and customer overlap before suggesting it.";
  }

  if (
    input.fromSignals.category &&
    input.toSignals.category &&
    !hasCategoryEvidence &&
    input.score < 38
  ) {
    return "Categories do not obviously align; use the workflow or need overlap as the reason to check.";
  }

  return null;
}

function getFitLabel(score: number, hasCaution: boolean): FitLabel {
  if (!hasCaution && score >= 70) {
    return "strong";
  }

  if (!hasCaution && score >= 42) {
    return "good";
  }

  return "check";
}

function buildReason(
  from: FounderForMatching,
  to: FounderForMatching,
  positiveEvidence: WeightedEvidence[],
  caution: string | null,
): string {
  const topEvidence = positiveEvidence
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, 2);

  if (topEvidence.length === 0) {
    return caution ?? "Low-signal pair; review manually before suggesting an intro.";
  }

  const reason = topEvidence
    .map((item) => `${item.label.toLowerCase()}: ${item.detail}`)
    .join("; ");

  return `${from.name} and ${to.name} match on ${reason}.`;
}

function buildOpener(
  from: FounderForMatching,
  to: FounderForMatching,
  positiveEvidence: WeightedEvidence[],
  sameCompany: boolean,
): string {
  if (sameCompany) {
    return `Not a new intro: use ${to.name} as context on ${companyLabel(to)} before meeting ${from.name}.`;
  }

  const theme =
    positiveEvidence.find((item) => item.kind === "need_keyword")?.detail ??
    positiveEvidence.find((item) => item.kind === "workflow")?.detail ??
    positiveEvidence.find((item) => item.kind === "category")?.detail ??
    "a potentially useful founder overlap";
  const ask = cleanSentence(from.need_text ?? from.ask ?? "compare notes");

  return `${from.name}, you mentioned ${ask}. ${to.name} at ${companyLabel(
    to,
  )} may be useful to compare notes with on ${theme}.`;
}

function compareSuggestions(
  a: IntroSuggestion & { score: number },
  b: IntroSuggestion & { score: number },
): number {
  return (
    fitRank(a.fit_label) - fitRank(b.fit_label) ||
    b.score - a.score ||
    String(a.caution ?? "").localeCompare(String(b.caution ?? "")) ||
    a.to_founder_id.localeCompare(b.to_founder_id)
  );
}

function fitRank(label: FitLabel): number {
  if (label === "strong") {
    return 0;
  }

  if (label === "good") {
    return 1;
  }

  return 2;
}

function isSameCompany(
  from: FounderForMatching,
  to: FounderForMatching,
): boolean {
  if (from.company_id && to.company_id && from.company_id === to.company_id) {
    return true;
  }

  return Boolean(
    from.company_name &&
      to.company_name &&
      normalize(from.company_name) === normalize(to.company_name),
  );
}

function findClusters(
  text: string,
  clusters: Record<string, string[]>,
): Set<string> {
  return new Set(
    Object.entries(clusters)
      .filter(([, terms]) => includesAny(text, terms))
      .map(([cluster]) => cluster)
      .sort(),
  );
}

function includesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(normalize(term)));
}

function normalizeCategory(category?: string | null): string {
  if (!category) {
    return "";
  }

  const normalized = normalize(category);

  return CATEGORY_ALIASES[normalized] ?? normalized;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .split(" ")
      .map(stemToken)
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
      .sort(),
  );
}

function stemToken(token: string): string {
  return token
    .replace(/'s$/, "")
    .replace(/ies$/, "y")
    .replace(/ing$/, "")
    .replace(/ers$/, "er")
    .replace(/s$/, "");
}

function normalize(value?: string | null): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function companyLabel(founder: FounderForMatching): string {
  return founder.company_name ?? "their company";
}

function cleanSentence(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ");

  if (!trimmed) {
    return "compare notes";
  }

  return trimmed.replace(/[.!?]+$/, "");
}

function sumEvidence(evidence: WeightedEvidence[]): number {
  return evidence.reduce((sum, item) => sum + item.score, 0);
}
