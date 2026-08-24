export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="animate-fade-in-up"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: "0.75rem",
        padding: "3rem 1.5rem",
        border: "1px dashed var(--border)",
        borderRadius: "12px",
        background: "var(--surface)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: "44px",
          height: "44px",
          borderRadius: "50%",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--surface-2)",
          color: "var(--text-muted)",
          fontSize: "1.3rem",
        }}
      >
        ○
      </span>
      <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{title}</h2>
      <p style={{ margin: 0, color: "var(--text-muted)", maxWidth: "42ch" }}>{body}</p>
      {action}
    </div>
  );
}
