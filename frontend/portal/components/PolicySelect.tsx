"use client";

import { useEffect, useState } from "react";
import { fetchPolicies } from "@/lib/api";
import type { Policy } from "@/lib/types";

type LoadState = "loading" | "loaded" | "error";

export function PolicySelect({
  value,
  onChange,
  id,
  style,
}: {
  value: string;
  onChange: (policyNumber: string) => void;
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
        setPolicies(data);
        setState("loaded");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} style={style}>
      <option value="" disabled>
        Select a policy…
      </option>
      {policies.map((p) => (
        <option key={p.id} value={p.policyNumber}>
          {p.policyNumber} — {p.policyholderName}
          {p.status !== "active" ? ` (${p.status})` : ""}
        </option>
      ))}
    </select>
  );
}
