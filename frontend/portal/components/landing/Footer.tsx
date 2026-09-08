export function Footer() {
  return (
    <footer className="landing-footer">
      <a href="/" className="transition" style={{ display: "flex", alignItems: "center", gap: "0.5rem", textDecoration: "none" }}>
        <span
          aria-hidden="true"
          className="logo-glow"
          style={{
            width: "22px",
            height: "22px",
            borderRadius: "6px",
            background: "linear-gradient(135deg, var(--primary), var(--accent))",
            color: "var(--primary-contrast)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: "0.75rem",
          }}
        >
          C
        </span>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "0.9rem", color: "var(--ink)" }}>ClaimFlow</span>
      </a>
      <div style={{ fontSize: "12px", color: "var(--slate-soft)" }}>&copy; 2026 ClaimFlow AI. All rights reserved.</div>
    </footer>
  );
}
