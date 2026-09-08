export function CTABand() {
  return (
    <div className="landing-cta-band">
      <div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "26px", margin: "0 0 8px" }}>See it on your next claim.</h2>
        <p style={{ fontSize: "13.5px", color: "#b9c1d1", margin: 0 }}>Set up takes minutes. Your first routing rule can be live today.</p>
      </div>
      <a
        href="/signup"
        className="transition"
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "14.5px",
          fontWeight: 700,
          background: "var(--amber)",
          color: "var(--ink)",
          padding: "13px 28px",
          textDecoration: "none",
          display: "inline-block",
          flexShrink: 0,
        }}
      >
        Sign up &rarr;
      </a>
    </div>
  );
}
