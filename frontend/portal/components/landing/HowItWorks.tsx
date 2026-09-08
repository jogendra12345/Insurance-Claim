const STEPS = [
  {
    no: "STEP 01",
    title: "Submit",
    body: "The claimant files a claim with their policy details and supporting documents — bills, discharge summaries, lab reports.",
  },
  {
    no: "STEP 02",
    title: "AI triage",
    body: "Documents are read automatically. The claim is scored for risk, checked for fraud indicators, and routed to the right reviewer role.",
  },
  {
    no: "STEP 03",
    title: "Human decision",
    body: "A reviewer confirms the routing, checks the AI's reasoning, and makes the final call — every time, without exception.",
  },
];

export function HowItWorks() {
  return (
    <>
      <div id="how-it-works" style={{ textAlign: "center", paddingTop: "10px" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "13px", letterSpacing: "2px", textTransform: "uppercase", color: "var(--slate)", marginBottom: "10px" }}>
          How it works
        </div>
      </div>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "26px", textAlign: "center", margin: "6px 0 46px" }}>
        From submission to decision, in three steps
      </h2>

      <div className="landing-ledger-steps">
        {STEPS.map((step) => (
          <div key={step.no} className="landing-ledger-step">
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "13px", letterSpacing: "1.5px", color: "var(--amber)", marginBottom: "14px" }}>
              {step.no}
            </div>
            <h3 style={{ fontFamily: "var(--font-display)", fontSize: "19px", margin: "0 0 10px" }}>{step.title}</h3>
            <p style={{ fontSize: "13px", color: "var(--slate)", lineHeight: 1.6, margin: 0 }}>{step.body}</p>
          </div>
        ))}
      </div>
    </>
  );
}
