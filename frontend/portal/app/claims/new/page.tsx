"use client";

import { Suspense } from "react";
import { ClaimForm } from "@/components/ClaimForm";

export default function NewClaimPage() {
  return (
    <Suspense fallback={null}>
      <main className="animate-fade-in-up" style={{ width: "85%", maxWidth: "900px", minWidth: "320px", margin: "0 auto", padding: "1rem 1.5rem 4rem" }}>
        <a href="/" className="transition" style={{ fontSize: "0.85rem", color: "var(--text-muted)", textDecoration: "none" }}>
          ← Back to your claims
        </a>
        <h1 style={{ margin: "0.6rem 0 0.2rem", fontSize: "1.75rem" }}>Submit a claim</h1>
        <p style={{ margin: 0, marginBottom: "1.1rem", color: "var(--text-muted)" }}>
          A few quick steps — your policy, what happened, and any supporting documents.
        </p>

        <ClaimForm />
      </main>
    </Suspense>
  );
}
