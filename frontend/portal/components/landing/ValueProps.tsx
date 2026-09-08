const VALUES = [
  {
    title: "Nothing happens off the record",
    body: "Every automated and human action is written to an audit trail the moment it happens — not reconstructed after the fact.",
  },
  {
    title: "AI recommends, it doesn't decide",
    body: "Risk scores and routing are suggestions a reviewer sees and can override. The final decision is always a human one.",
  },
  {
    title: "Rules you can actually change",
    body: "Routing thresholds are configuration, not code. Adjust what counts as high-risk without a deployment.",
  },
  {
    title: "Built to extend",
    body: "Start with one claim type, add another later. The review and audit flow doesn't change underneath you.",
  },
];

export function ValueProps() {
  return (
    <>
      <div style={{ textAlign: "center", paddingTop: "10px" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "13px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--slate)", marginBottom: "10px" }}>
          Why ClaimFlow AI
        </div>
      </div>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "26px", textAlign: "center", margin: "6px 0 46px" }}>
        Built for teams who have to show their work
      </h2>

      <div className="landing-value-grid">
        {VALUES.map((v) => (
          <div key={v.title} className="landing-value-item">
            <h4 style={{ fontFamily: "var(--font-display)", fontSize: "16px", margin: "0 0 8px" }}>{v.title}</h4>
            <p style={{ fontSize: "13px", color: "var(--slate)", lineHeight: 1.6, margin: 0 }}>{v.body}</p>
          </div>
        ))}
      </div>
    </>
  );
}
