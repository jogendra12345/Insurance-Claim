export function TopBar() {
  return (
    <header
      style={{
        borderBottom: "1px solid var(--border)",
        background: "var(--surface)",
      }}
    >
      <div
        style={{
          maxWidth: "840px",
          margin: "0 auto",
          padding: "1rem 1.5rem",
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: "28px",
            height: "28px",
            borderRadius: "8px",
            background: "var(--primary)",
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
        <a
          href="/"
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            fontSize: "1.05rem",
            color: "var(--text)",
            textDecoration: "none",
          }}
        >
          ClaimFlow
        </a>
      </div>
    </header>
  );
}
