"use client";

import { useEffect, useRef, useState } from "react";
import { fetchProviders } from "@/lib/api";
import type { Provider } from "@/lib/types";

type LoadState = "loading" | "loaded" | "error";

/**
 * Provider picker for the claim form's NPI field. Search by NPI digits or
 * facility name; selecting a suggestion reports the full Provider so the
 * form can autofill (and lock) facility name/address/tax ID — matching
 * POST /api/claims's find-or-create-by-NPI behavior, where those fields are
 * silently discarded on an NPI collision (SPEC.md "FNOL extended fields").
 * Typing a fresh, non-matching 10-digit NPI still works for registering a
 * new provider — the query is passed through as the NPI in that case.
 */
export function ProviderSelect({
  value,
  onChange,
  onProviderSelect,
  id,
  style,
}: {
  value: string;
  onChange: (npi: string) => void;
  onProviderSelect: (provider: Provider | undefined) => void;
  id?: string;
  style?: React.CSSProperties;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProviders()
      .then((data) => {
        if (!cancelled) {
          setProviders(data);
          setState("loaded");
        }
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const q = query.trim().toLowerCase();
  const matches = (
    q ? providers.filter((p) => p.npi.includes(q) || p.facilityName.toLowerCase().includes(q)) : providers
  ).slice(0, 8);

  function select(provider: Provider) {
    setQuery(provider.npi);
    setOpen(false);
    onChange(provider.npi);
    onProviderSelect(provider);
  }

  function handleInputChange(next: string) {
    // Digits only up to 10 chars when it looks like raw NPI entry; letters
    // pass through untouched so facility-name search still works.
    const cleaned = /^[0-9]*$/.test(next) ? next.slice(0, 10) : next;
    setQuery(cleaned);
    setOpen(true);
    setHighlighted(0);
    // A fresh, non-matching NPI is a valid "register a new provider" path —
    // pass digit-only input straight through as the NPI value. A name
    // search (contains letters) isn't a valid NPI yet, so clear it until a
    // suggestion is picked.
    const isDigits = /^[0-9]{0,10}$/.test(cleaned);
    onChange(isDigits ? cleaned : "");
    onProviderSelect(undefined);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(matches[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const disabled = state !== "loaded";

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        inputMode="numeric"
        disabled={disabled}
        value={state === "loading" ? "Loading providers…" : state === "error" ? "Couldn't load providers" : query}
        onChange={(e) => handleInputChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="NPI or facility name…"
        style={{ ...style, width: "100%" }}
      />
      {open && matches.length > 0 && (
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
            maxHeight: "220px",
            overflowY: "auto",
          }}
        >
          {matches.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === highlighted}
              onMouseDown={(e) => {
                e.preventDefault();
                select(p);
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
              <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{p.npi}</span>
              <span style={{ color: "var(--text-muted)" }}> — {p.facilityName}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
