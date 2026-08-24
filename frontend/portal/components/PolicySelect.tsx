"use client";

import { useEffect, useRef, useState } from "react";
import { fetchPolicies } from "@/lib/api";
import type { Policy } from "@/lib/types";

type LoadState = "loading" | "loaded" | "error";

const displayLabel = (p: Policy) => `${p.policyNumber} — ${p.policyholderName}`;

export function PolicySelect({
  value,
  onChange,
  onPolicySelect,
  id,
  style,
}: {
  value: string;
  onChange: (policyNumber: string) => void;
  /** Fires with the full matching policy whenever the selection changes, and once more after the list loads if `value` was already prefilled. */
  onPolicySelect?: (policy: Policy | undefined) => void;
  id?: string;
  style?: React.CSSProperties;
}) {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPolicies()
      .then((data) => {
        if (cancelled) return;
        // Claims are only ever filed against/filtered by active policies —
        // lapsed/cancelled ones stay manageable on the Policies tab, but
        // don't clutter this picker.
        const active = data.filter((p) => p.status === "active");
        setPolicies(active);
        setState("loaded");
        if (value) {
          const match = active.find((p) => p.policyNumber === value);
          if (match) setQuery(displayLabel(match));
          onPolicySelect?.(match);
        }
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
    // Only re-run on mount — `value`/`onPolicySelect` are read for the initial prefill only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const matches = q
    ? policies
        .filter((p) => p.policyNumber.toLowerCase().includes(q) || p.policyholderName.toLowerCase().includes(q))
        .slice(0, 8)
    : [];

  function select(policy: Policy) {
    setQuery(displayLabel(policy));
    setOpen(false);
    onChange(policy.policyNumber);
    onPolicySelect?.(policy);
  }

  function handleInputChange(next: string) {
    setQuery(next);
    setOpen(true);
    setHighlighted(0);
    // Typing invalidates any prior selection until the claimant picks a
    // suggestion again — clears the parent's policyNumber/policy so a
    // stale selection can't silently ride along with edited text.
    onChange("");
    onPolicySelect?.(undefined);
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
        disabled={disabled}
        value={
          state === "loading" ? "Loading policies…" : state === "error" ? "Couldn't load policies" : query
        }
        onChange={(e) => handleInputChange(e.target.value)}
        onFocus={() => query.trim() && setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="Type your name or policy number…"
        style={{ ...style, width: "100%" }}
      />
      {open && q && (
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
          {matches.length === 0 && (
            <li style={{ padding: "0.5rem 0.6rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
              No policy matches &ldquo;{query}&rdquo;.
            </li>
          )}
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
              <span style={{ fontWeight: 600 }}>{p.policyNumber}</span>
              <span style={{ color: "var(--text-muted)" }}> — {p.policyholderName}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
