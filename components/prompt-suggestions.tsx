"use client";
import { useEffect, useState } from "react";
import {
  ArrowUpLeft,
  GitCompareArrows,
  History,
  Search,
  Waypoints,
} from "lucide-react";
type Suggestion = {
  id: string;
  text: string;
  kind: "generic" | "history";
  topic?: string;
};
type Suggestions = { suggestions: Suggestion[]; personalized: boolean };
const fallback: Suggestions = {
  personalized: false,
  suggestions: [
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
  ],
};
export function PromptSuggestions({
  refreshKey,
  disabled,
  onSelect,
}: {
  refreshKey: number;
  disabled: boolean;
  onSelect: (text: string) => void;
}) {
  const [data, setData] = useState(fallback);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/suggestions", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Suggestions unavailable");
        const body: unknown = await response.json();
        if (
          typeof body !== "object" ||
          body === null ||
          !("suggestions" in body) ||
          !Array.isArray(body.suggestions)
        )
          throw new Error("Invalid suggestions");
        const suggestions = body.suggestions
          .filter(
            (s): s is Suggestion =>
              typeof s === "object" &&
              s !== null &&
              typeof s.id === "string" &&
              typeof s.text === "string" &&
              s.text.trim().length > 0 &&
              ["generic", "history"].includes(s.kind),
          )
          .slice(0, 3);
        if (!suggestions.length) throw new Error("No suggestions");
        if (!controller.signal.aborted)
          setData({
            suggestions,
            personalized: suggestions.some((s) => s.kind === "history"),
          });
      })
      .catch(() => {
        if (!controller.signal.aborted) setData(fallback);
      });
    return () => controller.abort();
  }, [refreshKey]);
  const icons = [GitCompareArrows, Search, Waypoints];
  return (
    <section className="suggestions" aria-label="Suggested questions">
      <div className="suggestions-label">
        {data.personalized ? "From your conversations" : "A place to start"}
      </div>
      {data.suggestions.map((suggestion, index) => {
        const Icon =
          suggestion.kind === "history" ? History : icons[index % icons.length];
        return (
          <button
            className="suggestion-row"
            key={suggestion.id}
            title={suggestion.text}
            aria-label={suggestion.text}
            disabled={disabled}
            onClick={() => onSelect(suggestion.text)}
          >
            <Icon size={19} strokeWidth={1.5} />
            <span>{suggestion.text}</span>
            <ArrowUpLeft className="suggestion-action" size={16} />
          </button>
        );
      })}
    </section>
  );
}
