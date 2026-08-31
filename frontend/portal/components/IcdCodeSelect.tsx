"use client";

import { useEffect, useRef, useState } from "react";
import { searchIcd10Codes, type Icd10Suggestion } from "@/lib/icd10";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

/**
 * Diagnosis-code autocomplete for the claim form, backed by NLM's free
 * Clinical Table Search Service (US ICD-10-CM only — see SPEC.md §3 for the
 * multi-country gap this doesn't cover). Search by code or condition name
 * ("E11.9" or "diabetes"); selecting a suggestion fills the code.
 *
 * Free text always still works — this never blocks typing/submitting a
 * code the lookup didn't suggest, or if the lookup service is unreachable.
 * Existing ICD-10-CM format validation in ClaimForm/backend is unchanged.
 */
export function IcdCodeSelect({
  value,
  onChange,
  onBlur,
  id,
  style,
}: {
  value: string;
  onChange: (code: string) => void;
  onBlur?: () => void;
  id?: string;
  style?: React.CSSProperties;
}) {
  const [suggestions, setSuggestions] = useState<Icd10Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleInputChange(next: string) {
    onChange(next);
    setHighlighted(0);
    setLoadError(false);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    const query = next.trim();
    if (query.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const requestId = ++requestIdRef.current;
      try {
        const results = await searchIcd10Codes(query);
        if (requestId !== requestIdRef.current) return; // a newer keystroke superseded this response
        setSuggestions(results);
        setOpen(results.length > 0);
      } catch {
        if (requestId !== requestIdRef.current) return;
        setSuggestions([]);
        setLoadError(true);
      }
    }, DEBOUNCE_MS);
  }

  function select(suggestion: Icd10Suggestion) {
    onChange(suggestion.code);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(suggestions[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        onChange={(e) => handleInputChange(e.target.value)}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onKeyDown={handleKeyDown}
        onBlur={onBlur}
        placeholder="Search by code or condition (e.g. E11.9 or diabetes)"
        style={{ ...style, width: "100%" }}
      />
      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="animate-scale-in"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 20,
            margin: 0,
            padding: "0.25rem",
            listStyle: "none",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            background: "var(--surface)",
            boxShadow: "var(--shadow-card)",
            maxHeight: "240px",
            overflowY: "auto",
          }}
        >
          {suggestions.map((s, i) => (
            <li
              key={s.code}
              role="option"
              aria-selected={i === highlighted}
              onMouseDown={(e) => {
                e.preventDefault();
                select(s);
              }}
              onMouseEnter={() => setHighlighted(i)}
              style={{
                padding: "0.5rem 0.6rem",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
                fontSize: "0.9rem",
                background: i === highlighted ? "var(--surface-2)" : "transparent",
              }}
            >
              <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{s.code}</span>
              <span style={{ color: "var(--text-muted)" }}> — {s.name}</span>
            </li>
          ))}
        </ul>
      )}
      {loadError && (
        <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
          Couldn't reach the code lookup service — you can still type a code directly.
        </span>
      )}
    </div>
  );
}
