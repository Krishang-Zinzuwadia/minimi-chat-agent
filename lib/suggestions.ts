import type {
  PromptSuggestion,
  RecentQuestion,
  SuggestionsResponse,
} from "./types";

export const MAX_SUGGESTION_QUESTIONS = 40;
export const MAX_SUGGESTION_QUESTION_LENGTH = 4000;
const DAY = 86_400_000;
const GENERIC: readonly PromptSuggestion[] = [
  {
    id: "generic-explain",
    text: "Explain a complex idea with a simple example.",
    kind: "generic",
  },
  {
    id: "generic-compare",
    text: "Help me compare two options and weigh the trade-offs.",
    kind: "generic",
  },
  {
    id: "generic-plan",
    text: "Turn a rough idea into a practical plan.",
    kind: "generic",
  },
];

interface Topic {
  id: string;
  label: string;
  family: string;
  match: RegExp;
}
// These labels are public subject names, not sample user history. Specific topics
// precede their parent so "React hooks" does not also generate "React".
const TOPICS: readonly Topic[] = [
  {
    id: "react-hooks",
    label: "React hooks",
    family: "react",
    match: /\breact\s+hooks?\b/i,
  },
  {
    id: "next-routing",
    label: "Next.js routing",
    family: "next",
    match: /\bnext(?:\.js|js)?\s+(?:app\s+)?rout(?:ing|er|es)\b/i,
  },
  {
    id: "postgres",
    label: "PostgreSQL",
    family: "postgres",
    match: /\bpostgres(?:ql)?\b/i,
  },
  { id: "react", label: "React", family: "react", match: /\bReact\b/ },
  {
    id: "next",
    label: "Next.js",
    family: "next",
    match: /\bnext(?:\.js|js)\b/i,
  },
  {
    id: "typescript",
    label: "TypeScript",
    family: "typescript",
    match: /\btypescript\b/i,
  },
  {
    id: "javascript",
    label: "JavaScript",
    family: "javascript",
    match: /\bjavascript\b/i,
  },
  { id: "python", label: "Python", family: "python", match: /\bpython\b/i },
  {
    id: "rust",
    label: "Rust programming",
    family: "rust",
    match: /\bRust\b|\brust\s+(?:programming|code|language)\b/,
  },
  { id: "docker", label: "Docker", family: "docker", match: /\bdocker\b/i },
  {
    id: "kubernetes",
    label: "Kubernetes",
    family: "kubernetes",
    match: /\bkubernetes\b/i,
  },
  {
    id: "cloudflare",
    label: "Cloudflare",
    family: "cloudflare",
    match: /\bcloudflare\b/i,
  },
  {
    id: "github-actions",
    label: "GitHub Actions",
    family: "ci",
    match: /\bgithub\s+actions\b/i,
  },
  {
    id: "unit-testing",
    label: "unit testing",
    family: "testing",
    match: /\bunit\s+test(?:s|ing)?\b/i,
  },
  {
    id: "api-design",
    label: "API design",
    family: "api",
    match: /\bapi\s+design\b/i,
  },
  {
    id: "typography",
    label: "typography",
    family: "typography",
    match: /\btypography\b/i,
  },
  {
    id: "css-layouts",
    label: "CSS layouts",
    family: "css",
    match: /\bcss\s+(?:grid|flexbox|layouts?)\b/i,
  },
  {
    id: "accessibility",
    label: "web accessibility",
    family: "accessibility",
    match: /\bweb\s+accessibility\b/i,
  },
  {
    id: "data-visualization",
    label: "data visualization",
    family: "visualization",
    match: /\bdata\s+visuali[sz]ation\b/i,
  },
  {
    id: "photography",
    label: "photography",
    family: "photography",
    match: /\bphotography\b/i,
  },
  {
    id: "gardening",
    label: "gardening",
    family: "gardening",
    match: /\bgardening\b/i,
  },
  {
    id: "bread-baking",
    label: "bread baking",
    family: "baking",
    match: /\b(?:bread\s+baking|baking\s+bread)\b/i,
  },
  {
    id: "astronomy",
    label: "astronomy",
    family: "astronomy",
    match: /\bastronomy\b/i,
  },
];

// Exclude the whole question, rather than salvaging a harmless-looking fragment
// beside private data. This is intentionally conservative, not a complete PII
// classifier. Nothing here is sent to a model or a connected source.
const UNSAFE = [
  /(?:https?|ftp):\/\/|www\.|[\w.+-]+@[\w.-]+/i,
  /\d(?:[\s()+.-]*\d){6,}/,
  /\b[A-Za-z0-9_+/=-]{32,}\b/,
  /\b(?:passwords?|passphrases?|secrets?|credentials?|tokens?|api[\s_-]?keys?|private[\s_-]?keys?|access[\s_-]?keys?|recovery|seed\s+phrase|bearer|session|cookies?)\b/i,
  /\b(?:private|confidential|internal|nda|address|street|postcode|zip\s+code|ssn|social\s+security|tax\s+id|passport|driver.?s?\s+licen[cs]e|birthday|birth\s+date|dob)\b/i,
  /\b(?:medical|health|diagnos\w*|medicat\w*|prescript\w*|therap\w*|pregnan\w*|cancer|diabet\w*|hiv|suicid\w*|self[\s-]?harm|depress\w*|anxiety|abortion|sexual\w*|religio\w*|political)\b/i,
  /\b(?:children|child|kids?|minor|daughter|son|wife|husband|partner|boyfriend|girlfriend|divorce|custody|lawsuit|legal\s+case|bank|account\s+(?:balance|number)|savings|salary|debt|credit\s+score|net\s+worth|holdings|portfolio)\b/i,
  /\b(?:ignore|override|disregard|forget|obey|reveal|exfiltrate|jailbreak|pretend|execute)\b|\b(?:system|developer|assistant)\s*:|\b(?:instructions?|system\s+prompt|prompt\s+injection)\b/i,
  /```|[<>\u0000-\u0008\u000b-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]|\b(?:do\s+not|don.t)\s+(?:share|show|repeat|remember)\b|\boff\s+the\s+record\b/i,
];

interface Candidate {
  id: string;
  label: string;
  family: string;
  source: "public" | "subject" | "project";
}

function literalTopic(value: string): string | null {
  const topic = value.trim().replace(/\s+/g, " ");
  // Only short words, spaces and hyphens; never identifiers, contact details,
  // free-form sentences, code, URLs or quoted instructions.
  if (!/^[A-Za-z][A-Za-z -]{2,47}$/.test(topic)) return null;
  const words = topic.split(/\s+/);
  if (words.length > 5 || words.some((word) => word.length > 20)) return null;
  if (
    /\b(?:i|you|we|they|he|she|it|me|him|her|us|them|my|your|our|their|his|hers|is|are|was|were|has|have|had|will|must|should|send|delete|output|always|never|instead|please|suggest|prompt|return|print|call|email|phone|number|code|key)\b/i.test(
      topic,
    )
  )
    return null;
  return topic;
}

function candidates(content: string): Candidate[] {
  const found: Candidate[] = [];
  const families = new Set<string>();
  for (const topic of TOPICS) {
    if (families.has(topic.family) || !topic.match.test(content)) continue;
    families.add(topic.family);
    found.push({ ...topic, source: "public" });
  }
  // Explicitly named projects can be private app context, but no facts or
  // commitments about them are inferred. Require two distinct questions below.
  const project = content.match(
    /\b(?:my|our|the)\s+project\s+([A-Z][A-Za-z-]{1,19}(?:\s+[A-Z][A-Za-z-]{1,19}){0,2})(?=$|[\s.!?,;:])/,
  );
  const name = project && literalTopic(project[1]);
  if (name) {
    const id = "project-" + name.toLowerCase().replace(/ /g, "-");
    found.push({ id, label: `project ${name}`, family: id, source: "project" });
  }
  // Anchored, whole-question forms keep the extracted subject small and avoid
  // guessing nouns from long prose. Other phrasings safely remain generic.
  const subject = content.match(
    /^(?:please\s+)?(?:research|explain|tell me about|help me understand)\s+([A-Za-z][A-Za-z -]{2,47})[.?]?$/i,
  );
  const label = subject && literalTopic(subject[1]);
  // Unknown title-cased names are ambiguous people/organizations. Only the
  // explicit project form above permits copying those into a suggestion.
  if (label && label === label.toLowerCase()) {
    const id = "subject-" + label.toLowerCase().replace(/ /g, "-");
    const parent = found.find((topic) =>
      label.toLowerCase().includes(topic.label.toLowerCase()),
    );
    // Prefer a meaningful phrase to its broad parent only after repetition.
    if (
      !found.some((topic) => topic.label.toLowerCase() === label.toLowerCase())
    )
      found.push({
        id,
        label,
        family: parent?.family ?? id,
        source: "subject",
      });
  }
  return found;
}

/**
 * Deterministic, ephemeral topic matching over at most 40 owner-authored questions.
 * Public topics can surface from one clear question within 7 days. Extracted
 * English subjects/project names need two distinct questions within 30 days.
 * Unknown/ambiguous/sensitive inputs stay generic. This is not semantic memory or
 * a comprehensive sensitivity detector, and never writes an inferred profile.
 */
export function buildSuggestions(
  questions: readonly RecentQuestion[],
  now = new Date(),
): SuggestionsResponse {
  const history = new Map<
    string,
    Candidate & { hits: number; latest: number }
  >();
  const seen = new Set<string>();
  const nowMs = now.getTime();
  for (const question of questions.slice(0, MAX_SUGGESTION_QUESTIONS)) {
    if (
      typeof question?.content !== "string" ||
      question.content.length > MAX_SUGGESTION_QUESTION_LENGTH
    )
      continue;
    const content = question.content.trim();
    const asked = Date.parse(question.createdAt);
    if (
      !content ||
      !Number.isFinite(asked) ||
      !Number.isFinite(nowMs) ||
      asked > nowMs + 60_000 ||
      nowMs - asked > 30 * DAY
    )
      continue;
    if (UNSAFE.some((pattern) => pattern.test(content))) continue;
    const fingerprint = content.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    for (const topic of candidates(content)) {
      const existing = history.get(topic.id);
      history.set(topic.id, {
        ...topic,
        hits: (existing?.hits ?? 0) + 1,
        latest: Math.max(existing?.latest ?? 0, asked),
      });
    }
  }
  const ranked = [...history.values()]
    .filter(
      (topic) =>
        topic.hits >= 2 ||
        (topic.source === "public" && nowMs - topic.latest <= 7 * DAY),
    )
    .sort((a, b) => {
      const score = (topic: typeof a) =>
        Math.min(topic.hits, 5) * 4 +
        Math.max(0, 7 - (nowMs - topic.latest) / DAY) +
        (topic.source !== "public" ? 1 : 0);
      return (
        score(b) - score(a) || b.latest - a.latest || a.id.localeCompare(b.id)
      );
    });
  const families = new Set<string>();
  const suggestions: PromptSuggestion[] = [];
  for (const topic of ranked) {
    if (families.has(topic.family)) continue;
    families.add(topic.family);
    suggestions.push({
      id: `history-${topic.id}`,
      text:
        topic.source === "project"
          ? `Help me work out the next steps for ${topic.label}.`
          : `Help me explore ${topic.label} with a practical example.`,
      kind: "history",
      topic: topic.label,
    });
    if (suggestions.length === 3) break;
  }
  const personalized = suggestions.length > 0;
  suggestions.push(
    ...GENERIC.slice(0, 3 - suggestions.length).map((suggestion) => ({
      ...suggestion,
    })),
  );
  return { suggestions, personalized };
}
