"use client";

import { Suspense } from "react";
import { ClaimForm } from "@/components/ClaimForm";

export default function NewClaimPage() {
  return (
    <Suspense fallback={null}>
      <main style={{ maxWidth: "640px", margin: "0 auto", padding: "2.5rem 1.5rem 4rem" }}>
        <a href="/" style={{ fontSize: "0.85rem", color: "var(--text-muted)", textDecoration: "none" }}>
          ← Back to your claims
        </a>
        <h1 style={{ marginTop: "0.75rem", marginBottom: "0.25rem", fontSize: "1.6rem" }}>Submit a claim</h1>
        <p style={{ marginTop: 0, marginBottom: "2rem", color: "var(--text-muted)" }}>
          Tell us what happened and attach any supporting documents — bills, discharge summaries, or
          prescriptions.
        </p>
        <ClaimForm />
      </main>
    </Suspense>
  );
}
