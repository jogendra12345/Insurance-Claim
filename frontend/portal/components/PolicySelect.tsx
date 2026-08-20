"use client";

import { useEffect, useState } from "react";
import { fetchPolicies } from "@/lib/api";
import type { Policy } from "@/lib/types";

type LoadState = "loading" | "loaded" | "error";

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
          onPolicySelect?.(active.find((p) => p.policyNumber === value));
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

  function handleChange(policyNumber: string) {
    onChange(policyNumber);
    onPolicySelect?.(policies.find((p) => p.policyNumber === policyNumber));
  }

  if (state === "loading") {
    return (
      <select disabled style={style} aria-busy="true">
        <option>Loading policies…</option>
      </select>
    );
  }

  if (state === "error") {
    return (
      <select disabled style={style}>
        <option>Couldn&apos;t load policies</option>
      </select>
    );
  }

  return (
    <select id={id} value={value} onChange={(e) => handleChange(e.target.value)} style={style}>
      <option value="" disabled>
        Select a policy…
      </option>
      {policies.map((p) => (
        <option key={p.id} value={p.policyNumber}>
          {p.policyNumber} — {p.policyholderName}
        </option>
      ))}
    </select>
  );
}
