import type { AssignedRole, Claim } from "@/lib/types";

// design-reference/landing.html's mini-card is a static, illustrative
// example — the landing page makes no API calls (see LandingPage.tsx) — but
// its fields are named after the real Claim type (SPEC.md §8) rather than
// invented, so this reads as "a real claim" would on the actual Claim
// Detail page. Values match the mockup's own example exactly.
const EXAMPLE_CLAIM: Pick<Claim, "claimantName" | "policyNumber" | "claimAmount" | "riskScore" | "fraudIndicatorCount" | "confirmedRole"> = {
  claimantName: "Omar Haddad",
  policyNumber: "POL-100002",
  claimAmount: 500,
  riskScore: 65,
  fraudIndicatorCount: 2,
  confirmedRole: "investigator",
};

const ROLE_LABEL: Record<AssignedRole, string> = {
  adjuster: "Adjuster",
  investigator: "Investigator",
  legal: "Legal",
  auto: "Auto-approved",
};

function currency(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export function Hero() {
  const c = EXAMPLE_CLAIM;
  return (
    <section className="landing-hero">
      <div className="landing-hero-left">
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "13px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--slate)", marginBottom: "10px" }}>
          AI-Assisted Claims Triage
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "42px", lineHeight: 1.18, letterSpacing: "-0.5px", margin: "14px 0 20px" }}>
          Intelligent triage, accountable decisions.
        </h1>
        <p style={{ fontSize: "15.5px", lineHeight: 1.65, color: "var(--slate)", margin: "0 0 30px", maxWidth: "500px" }}>
          ClaimFlow AI reads every submitted document, flags what needs a closer look, and routes each claim to the
          right reviewer. A human always confirms the routing and makes the final decision.
        </p>
        <div style={{ display: "flex", alignItems: "center", marginBottom: "26px", gap: "26px", flexWrap: "wrap" }}>
          <a
            href="/login"
            className="transition"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "14.5px",
              fontWeight: 700,
              background: "var(--ink)",
              color: "var(--paper)",
              padding: "13px 26px",
              textDecoration: "none",
              display: "inline-block",
            }}
          >
            Log in
          </a>
          <a
            href="/signup"
            className="transition"
            style={{ fontFamily: "var(--font-body)", fontSize: "14px", fontWeight: 700, color: "var(--ink)", textDecoration: "none" }}
          >
            Sign up &rarr;
          </a>
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "12.5px", letterSpacing: "0.3px", color: "var(--slate)", display: "flex", alignItems: "center", flexWrap: "wrap" }}>
          <TrustItem color="var(--forest)" label="Human-reviewed, always" />
          <TrustItem color="var(--amber)" label="Full audit trail" />
          <TrustItem color="var(--slate-soft)" label="Configurable routing rules" />
        </div>
      </div>

      <div className="landing-hero-right">
        <div
          style={{
            width: "300px",
            background: "var(--paper-raised)",
            border: "1px solid var(--rule)",
            boxShadow: "8px 8px 0 var(--paper-2), 0 1px 3px rgba(22,35,63,0.08)",
            padding: "20px 22px",
            transform: "rotate(2deg)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "1px solid var(--rule-soft)", paddingBottom: "10px", marginBottom: "12px" }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: "15px", fontWeight: 700 }}>{c.claimantName}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "10.5px", color: "var(--slate-soft)" }}>{c.policyNumber}</span>
          </div>
          <MiniRow label="Claim amount" value={currency(c.claimAmount)} />
          <MiniRow label="Risk score" badge={{ tone: "amber", text: `${c.riskScore} · High` }} />
          <MiniRow label="Fraud indicators" badge={{ tone: "crimson", text: `${c.fraudIndicatorCount} Flagged` }} />
          <MiniRow label="Routed to" value={c.confirmedRole ? ROLE_LABEL[c.confirmedRole] : "—"} />
        </div>
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            bottom: "18px",
            right: "6px",
            fontFamily: "var(--font-display)",
            fontSize: "13px",
            fontWeight: 700,
            letterSpacing: "2px",
            textTransform: "uppercase",
            color: "var(--forest)",
            border: "2px double var(--forest)",
            padding: "6px 12px",
            transform: "rotate(-8deg)",
            background: "var(--paper)",
          }}
        >
          Reviewed
        </div>
      </div>
    </section>
  );
}

function TrustItem({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", marginRight: "22px" }}>
      <span aria-hidden="true" style={{ width: "6px", height: "6px", borderRadius: "50%", background: color, display: "inline-block", marginRight: "8px" }} />
      {label}
    </span>
  );
}

function MiniRow({ label, value, badge }: { label: string; value?: string; badge?: { tone: "amber" | "crimson"; text: string } }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", fontSize: "12px" }}>
      <span style={{ color: "var(--slate)" }}>{label}</span>
      {badge ? (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            fontWeight: 700,
            padding: "2px 7px",
            background: badge.tone === "amber" ? "var(--amber-bg)" : "var(--crimson-bg)",
            color: badge.tone === "amber" ? "var(--amber)" : "var(--crimson)",
          }}
        >
          {badge.text}
        </span>
      ) : (
        <span style={{ fontWeight: 700, color: "var(--ink)" }}>{value}</span>
      )}
    </div>
  );
}
