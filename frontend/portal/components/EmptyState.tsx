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
      <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{title}</h2>
      <p style={{ margin: 0, color: "var(--text-muted)", maxWidth: "42ch" }}>{body}</p>
      {action}
    </div>
  );
}
