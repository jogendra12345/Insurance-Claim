"use client";

/** Prev/next pager for a table — shows a "start–end of total" label plus arrow buttons. */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : page * pageSize + 1;
  const end = Math.min(total, (page + 1) * pageSize);
  const canPrev = page > 0;
  const canNext = page < pageCount - 1;

  if (total <= pageSize) return null;

  return (
    <div
      className="animate-fade-in"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "1rem",
        padding: "0.85rem 1.1rem",
        borderTop: "1px solid var(--border)",
      }}
    >
      <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
        Showing <strong style={{ color: "var(--text)" }}>{start}–{end}</strong> of {total}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={!canPrev}
          aria-label="Previous page"
          className="transition btn-press"
          style={pagerButtonStyle(canPrev)}
        >
          <ChevronIcon direction="left" />
        </button>
        <span style={{ fontSize: "0.82rem", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
          Page {page + 1} of {pageCount}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={!canNext}
          aria-label="Next page"
          className="transition btn-press"
          style={pagerButtonStyle(canNext)}
        >
          <ChevronIcon direction="right" />
        </button>
      </div>
    </div>
  );
}

function pagerButtonStyle(enabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "30px",
    height: "30px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border)",
    background: "var(--surface)",
    color: enabled ? "var(--text)" : "var(--text-muted)",
    cursor: enabled ? "pointer" : "default",
    opacity: enabled ? 1 : 0.45,
  };
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d={direction === "left" ? "M10 3 L5 8 L10 13" : "M6 3 L11 8 L6 13"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
