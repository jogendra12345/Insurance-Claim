// design-reference/landing.html — the anonymous-landing header, rendered
// by TopBar.tsx in place of the app's normal Policies/Claims/Tasks nav
// (see TopBar.tsx's isAnonymousLanding branch). "Product" and "Security"
// are placeholder anchors (href="#") matching the mockup, which doesn't
// build sections for either — "How it works" is the one nav link with a
// real target (#how-it-works, added on that section).
export function LandingTopNav() {
  return (
    <header className="landing-topbar">
      <a href="/" className="transition" style={{ display: "flex", alignItems: "center", gap: "0.6rem", textDecoration: "none" }}>
        <span
          aria-hidden="true"
          className="logo-glow"
          style={{
            width: "28px",
            height: "28px",
            borderRadius: "8px",
            background: "linear-gradient(135deg, var(--primary), var(--accent))",
            color: "var(--primary-contrast)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: "0.95rem",
          }}
        >
          C
        </span>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "1.05rem", color: "var(--ink)" }}>ClaimFlow</span>
      </a>

      <div className="landing-nav-cta">
        <nav className="landing-topnav" aria-label="Product">
          <a href="#" style={{ color: "var(--slate)", textDecoration: "none" }}>
            Product
          </a>
          <a href="#how-it-works" style={{ color: "var(--slate)", textDecoration: "none" }}>
            How it works
          </a>
          <a href="#" style={{ color: "var(--slate)", textDecoration: "none" }}>
            Security
          </a>
        </nav>
        <a
          href="/login"
          className="transition"
          style={{ fontFamily: "var(--font-body)", fontSize: "14px", fontWeight: 700, color: "var(--ink)", textDecoration: "none" }}
        >
          Log in
        </a>
        <a
          href="/signup"
          className="transition"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "13.5px",
            fontWeight: 700,
            color: "var(--ink)",
            textDecoration: "none",
            border: "1.5px solid var(--ink)",
            padding: "9px 18px",
          }}
        >
          Sign up
        </a>
      </div>
    </header>
  );
}
