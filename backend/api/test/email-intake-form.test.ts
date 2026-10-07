// Pure pieces of email claim intake — .claude/specs/generic/email-claim-intake.md.
// No database or network.
import { describe, expect, it } from "vitest";
import {
  FORM_END,
  FORM_START,
  changedFormValues,
  checkSenderAuth,
  controlKeyword,
  detectIntent,
  findShortRef,
  formValues,
  isComplete,
  missingRequired,
  parseFormLines,
  renderForm,
  stripFormBlock,
  stripQuoted,
  type DraftState,
} from "../src/email-intake-form";

const ctx = { policies: ["POL-1234", "POL-5678"] };
const empty = (): DraftState => ({ collected: {}, invalid: {}, lowConfidence: [], documents: [] });

describe("renderForm", () => {
  it("renders every field between the markers with hints and pre-filled values", () => {
    const state = empty();
    state.collected.claimantName = "Sara Khan";
    const form = renderForm(state, ctx, false);
    const lines = form.split("\n");
    expect(lines[0]).toBe(FORM_START);
    expect(lines[lines.length - 1]).toBe(FORM_END);
    expect(form).toContain("Policy number (yours: POL-1234, POL-5678):");
    expect(form).toContain("Your full name: Sara Khan");
    expect(form).toContain("Claim type (outpatient/inpatient/pharmacy/dental/maternity/other):");
    expect(form).not.toContain("⚠");
  });

  it("flags missing and invalid lines with the reason, and low-confidence ones with ?", () => {
    const state = empty();
    state.invalid.providerNpi = { value: "123456789", error: "Provider NPI must be exactly 10 digits." };
    state.collected.diagnosisCode = "J18.9";
    state.lowConfidence = ["diagnosisCode"];
    const form = renderForm(state, ctx, true);
    expect(form).toContain("⚠ Provider NPI (10 digits): 123456789\n   → Provider NPI must be exactly 10 digits.");
    expect(form).toContain("⚠ Procedure code (CPT or HCPCS, e.g. 99284, on your bill):\n   → Still needed.");
    expect(form).toContain("? Diagnosis code (ICD-10, e.g. J18.9, on your bill): J18.9");
    // Optional field isn't flagged when blank.
    expect(form).toMatch(/^Service date to \(leave blank if same day\):$/m);
  });
});

describe("parseFormLines", () => {
  it("reads a filled-in form, ignoring hints, flags and arrow lines", () => {
    const state = empty();
    state.invalid.providerNpi = { value: "123", error: "bad" };
    const sent = renderForm(state, ctx, true);
    const filled = sent
      .replace("Policy number (yours: POL-1234, POL-5678):", "Policy number (yours: POL-1234, POL-5678): pol-1234")
      .replace("⚠ Provider NPI (10 digits): 123", "⚠ Provider NPI (10 digits): 1234567890")
      .replace(/^⚠ What happened:$/m, "What happened: Slipped at work and hurt my wrist,\nhad an X-ray at the ER.");
    const parsed = parseFormLines(`Here you go\n\n${filled}`, `Here you go\n\n${filled}`);
    expect(parsed.foundBlock).toBe(true);
    expect(parsed.values.policyNumber).toBe("pol-1234");
    expect(parsed.values.providerNpi).toBe("1234567890");
    expect(parsed.values.incidentDescription).toBe("Slipped at work and hurt my wrist, had an X-ray at the ER.");
    expect(parsed.values.procedureCode).toBeUndefined();
  });

  it("finds the form inside the quoted part of a reply", () => {
    const form = renderForm(empty(), ctx, false).replace("Provider NPI (10 digits):", "Provider NPI (10 digits): 1234567890");
    const quoted = form
      .split("\n")
      .map((l) => `> ${l}`)
      .join("\n");
    const full = `Filled in below\n\nOn Tue, 7 Oct 2026 at 10:00, ClaimFlow Claims <claims@x.com> wrote:\n${quoted}`;
    const parsed = parseFormLines(full, stripQuoted(full));
    expect(parsed.values.providerNpi).toBe("1234567890");
  });

  it("reads answers typed above the quoted form, including a label Gmail wrapped (first live reply, 2026-10-07)", () => {
    const typed = [
      "Policy number (yours: POL-100013): POL-100013",
      "Claim type (outpatient / inpatient / pharmacy / dental / maternity /",
      "other): dental",
      "Incident date (e.g. 03/10/2026, 3 Oct 2026, today): 4 oct 2026",
      "What happened: Car Accident",
      "Provider NPI (10 digits):1234567890",
      "Total billed (USD, the provider's full bill):",
    ].join("\n");
    const quoted = renderForm(empty(), { policies: ["POL-100013"] }, false)
      .split("\n")
      .map((l) => `> ${l}`)
      .join("\n");
    const full = `${typed}\n\n\nOn Wed, 7 Oct 2026, 16:56 ClaimFlow Claims, <claims@x.com> wrote:\n\n${quoted}`;
    const parsed = parseFormLines(full, stripQuoted(full));
    expect(parsed.values).toMatchObject({
      policyNumber: "POL-100013",
      claimType: "dental",
      incidentDate: "4 oct 2026",
      incidentDescription: "Car Accident",
      providerNpi: "1234567890",
    });
    expect(parsed.values.totalBilledAmount).toBeUndefined();
  });

  it("keeps every rendered form line under the 76-character wrap", () => {
    const state = empty();
    for (const line of renderForm(state, ctx, true).split("\n")) expect(line.length).toBeLessThanOrEqual(76);
  });

  it("without a form block, reads known-label lines from free text", () => {
    const parsed = parseFormLines("Hi,\nNPI: 1234567890\nFacility name: City Hospital\nThanks", "Hi,\nNPI: 1234567890\nFacility name: City Hospital\nThanks");
    expect(parsed.foundBlock).toBe(false);
    expect(parsed.values).toEqual({ providerNpi: "1234567890", facilityName: "City Hospital" });
  });
});

describe("changedFormValues", () => {
  it("only counts lines that differ from the form as sent", () => {
    const state = empty();
    state.collected.claimantName = "Sara Khan";
    const baseline = formValues(state);
    const changed = changedFormValues({ values: { claimantName: "sara  khan", claimAmount: "1200" }, foundBlock: true }, baseline);
    expect(changed).toEqual({ claimAmount: "1200" });
  });
});

describe("completeness", () => {
  it("needs every required field, no invalid ones, and a document", () => {
    const state = empty();
    expect(missingRequired(state)).toContain("attested");
    expect(missingRequired(state)).not.toContain("serviceDateTo");
    Object.assign(state.collected, {
      policyNumber: "POL-1234", claimType: "outpatient", claimantName: "Sara", incidentDate: "2026-10-03",
      incidentDescription: "x", claimAmount: 100, diagnosisCode: "J18.9", procedureCode: "99284",
      serviceDateFrom: "2026-10-03", totalBilledAmount: 100, providerNpi: "1234567890", providerTaxId: "12-3",
      facilityName: "City", facilityAddress: "1 St", coordinationOfBenefits: false, attested: true,
    });
    expect(isComplete(state)).toBe(false);
    state.documents.push({ name: "bill.pdf", url: "u", contentType: "application/pdf", size: 1 });
    expect(isComplete(state)).toBe(true);
    state.invalid.providerNpi = { value: "1", error: "e" };
    expect(isComplete(state)).toBe(false);
  });
});

describe("stripQuoted / stripFormBlock", () => {
  it("keeps only the new text of a Gmail reply", () => {
    const text = "Procedure is 99284.\n\nOn Tue, Oct 7, 2026 at 10:00 AM ClaimFlow Claims <claims@x.com>\nwrote:\n> old stuff\n> more";
    expect(stripQuoted(text)).toBe("Procedure is 99284.");
  });

  it("cuts an Outlook header block and a signature", () => {
    expect(stripQuoted("NPI 1234567890\n\nFrom: ClaimFlow\nSent: Tuesday\nold")).toBe("NPI 1234567890");
    expect(stripQuoted("CONFIRM\n-- \nSara Khan\nAcme")).toBe("CONFIRM");
  });

  it("removes the form and label lines, leaving prose for the AI", () => {
    const text = `Also the bill says NPI is on page 2.\n${renderForm(empty(), ctx, false)}\nFacility name: City`;
    expect(stripFormBlock(text)).toBe("Also the bill says NPI is on page 2.");
  });
});

describe("intents and keywords", () => {
  it("detects the three intents from body first, then subject", () => {
    expect(detectIntent("", "raise a claim")).toBe("raise");
    expect(detectIntent("New claim please", "")).toBe("raise");
    expect(detectIntent("", "What's my policy status?")).toBe("policy_status");
    expect(detectIntent("Re: question", "status #a1b2c3d4")).toBe("claim_status");
    expect(detectIntent("hello", "hi there")).toBeNull();
  });

  it("finds a short claim reference", () => {
    expect(findShortRef("where is #A1B2C3D4 at?")).toBe("a1b2c3d4");
    expect(findShortRef("no ref")).toBeNull();
  });

  it("reads CONFIRM / CANCEL / RESTART only as a short first line", () => {
    expect(controlKeyword("CONFIRM")).toBe("confirm");
    expect(controlKeyword("Confirmed, thanks!")).toBe("confirm");
    expect(controlKeyword("cancel")).toBe("cancel");
    expect(controlKeyword("Start over")).toBe("restart");
    expect(controlKeyword("I can't confirm the NPI yet")).toBeNull();
  });
});

describe("checkSenderAuth", () => {
  const gmail =
    "mx.google.com; dkim=pass header.i=@gmail.com header.s=20230601 header.b=abc; " +
    "spf=pass (google.com: domain of sara@gmail.com designates 1.2.3.4 as permitted sender) smtp.mailfrom=sara@gmail.com; " +
    "dmarc=pass (p=NONE sp=QUARANTINE dis=NONE) header.from=gmail.com";

  it("passes on DMARC pass from our own receiver", () => {
    expect(checkSenderAuth([gmail], "sara@gmail.com", "mx.google.com").pass).toBe(true);
  });

  it("passes on aligned SPF + DKIM when there's no DMARC pass", () => {
    const h = "mx.google.com; dkim=pass header.i=@acme.com; spf=pass smtp.mailfrom=bounce@mail.acme.com; dmarc=none";
    expect(checkSenderAuth([h], "sara@acme.com", "mx.google.com").pass).toBe(true);
  });

  it("fails on a forged From (DMARC fail) or a header from another server", () => {
    const forged = "mx.google.com; dkim=pass header.i=@evil.com; spf=pass smtp.mailfrom=x@evil.com; dmarc=fail header.from=gmail.com";
    expect(checkSenderAuth([forged], "sara@gmail.com", "mx.google.com").pass).toBe(false);
    expect(checkSenderAuth(["evil.example; dmarc=pass header.from=gmail.com"], "sara@gmail.com", "mx.google.com").pass).toBe(false);
  });

  it("trusts only the topmost header from our receiver", () => {
    const fakeLower = "mx.google.com; dmarc=pass header.from=gmail.com";
    const real = "mx.google.com; dmarc=fail header.from=gmail.com";
    expect(checkSenderAuth([real, fakeLower], "sara@gmail.com", "mx.google.com").pass).toBe(false);
  });
});
