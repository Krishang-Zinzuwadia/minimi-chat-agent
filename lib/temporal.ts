const months = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const weekdays = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export function localDay(value: string | Date, timezone = "UTC") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function validDay(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date.toISOString().slice(0, 10)
    : null;
}

/** Intentionally conservative: ambiguous dates stay unresolved rather than guessed. */
export function resolveDate(text: string, now = new Date(), timezone = "UTC") {
  const lower = text.toLowerCase();
  const today = localDay(now, timezone);
  const anchor = new Date(`${today}T12:00:00Z`);
  const result = (day: string | null, expression: string) =>
    day ? { day, expression, timezone } : null;
  const iso = lower.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return result(validDay(+iso[1], +iso[2], +iso[3]), iso[0]);
  const names = months.map((m) => `${m}(?:)?|${m.slice(0, 3)}`).join("|");
  const before = lower.match(
    new RegExp(
      `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${names})(?:,?\\s+(\\d{4}))?\\b`,
    ),
  );
  const after = lower.match(
    new RegExp(
      `\\b(${names})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`,
    ),
  );
  if (before || after) {
    const match = (before || after)!;
    const day = +(before ? match[1] : match[2]);
    const name = before ? match[2] : match[1];
    const month = months.findIndex((m) => m.startsWith(name)) + 1;
    const explicitYear = match[3];
    let year = explicitYear ? +explicitYear : anchor.getUTCFullYear();
    let date = validDay(year, month, day);
    if (!explicitYear && date && date > today)
      date = validDay(--year, month, day);
    return result(date, match[0]);
  }
  const relative = lower.match(/\b(yesterday|today)\b/);
  // Prefer weekday references over a later "today" in freshness questions.
  const weekday = lower.match(
    /\b(last\s+|on\s+)(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
  );
  if (weekday) {
    let distance = (anchor.getUTCDay() - weekdays.indexOf(weekday[2]) + 7) % 7;
    if (weekday[1]?.trim() === "last" && distance === 0) distance = 7;
    anchor.setUTCDate(anchor.getUTCDate() - distance);
    return result(anchor.toISOString().slice(0, 10), weekday[0]);
  }
  if (relative) {
    if (relative[1] === "yesterday") anchor.setUTCDate(anchor.getUTCDate() - 1);
    return result(anchor.toISOString().slice(0, 10), relative[0]);
  }
  return null;
}

/** Freshness “today” is not a constraint on the date of the recalled question. */
export function retrievalDate(
  query: string,
  now = new Date(),
  timezone = "UTC",
) {
  // In a multi-clause question, a date attached to rechecking ("as of ...")
  // must not override the date attached to the saved conversation.
  const recall =
    /\b(?:what (?:did|have|were|was) (?:i|we)|(?:i|we) (?:asked|discussed|shortlisted|said)|(?:ask|asked) you|remember|our shortlist)\b/i;
  const clauses = query.split(
    /[?;!\n]|\.\s|,?\s+and\s+(?=(?:is|are|has|have|can|could|check|recheck)\b)/i,
  );
  const historical = clauses.find(
    (clause) => recall.test(clause) && resolveDate(clause, now, timezone),
  );
  const date = resolveDate(historical ?? query, now, timezone);
  if (
    date?.expression === "today" &&
    !/\bwhat (?:did|have|were|was|are) (?:i|we|you)\b.*\btoday\b|\btoday[, ]+(?:i|we) (?:asked|discussed|said|talked)\b|\b(?:ask|asked|discussed|said|talked)(?: (?:you|me))? today\b/i.test(
      query,
    )
  )
    return null;
  return date;
}
const stopwords = new Set(
  "what did i you we our on at the a an is are was were to about any has have had and or it them they that this today since last asked ask still correct changed pricing".split(
    " ",
  ),
);
export function lexicalTerms(query: string): string[] {
  return [
    ...new Set(
      (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(
        (x) => x.length > 2 && !stopwords.has(x),
      ),
    ),
  ].slice(0, 12);
}
