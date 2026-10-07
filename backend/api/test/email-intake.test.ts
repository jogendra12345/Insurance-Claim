// Email claim intake end to end through processInboundEmail() —
// .claude/specs/generic/email-claim-intake.md. Runs against the local
// Postgres (RUNNING-LOCALLY.md §2-3) with a throwaway policy; outbound mail,
// the AI and MinIO are swapped for in-memory fakes, and Zeebe is stubbed so
// createClaim() doesn't need Camunda running.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/zeebe", () => ({
  CLAIM_CASE_PROCESS_ID: "claim-case-process",
  zeebeClient: { createProcessInstance: vi.fn(async () => ({ processInstanceKey: "1" })) },
  camundaRestClient: { searchVariables: vi.fn(async () => ({ items: [] })), cancelProcessInstance: vi.fn() },
}));

import { pool } from "../src/db";
import { emailIntakeDeps, processInboundEmail, sweepDrafts, type AiExtraction, type InboundEmail } from "../src/email-intake";
import type { OutboundEmail } from "../src/email-intake-mailer";

const tag = randomUUID().slice(0, 8);
const sender = `email-intake-${tag}@claimflow.test`;
const stranger = `stranger-${tag}@claimflow.test`;
const policyNumber = `EML-${tag}`.toUpperCase();
const npi = String(Math.floor(1e9 + Math.random() * 8e9));
let policyId = "";

const outbox: OutboundEmail[] = [];
let aiResult: AiExtraction | null = null;

function authFor(address: string) {
  return [`mx.google.com; dkim=pass header.i=@${address.split("@")[1]}; spf=pass smtp.mailfrom=${address}; dmarc=pass header.from=${address.split("@")[1]}`];
}

function email(overrides: Partial<InboundEmail>): InboundEmail {
  return {
    messageId: `<${randomUUID()}@claimflow.test>`,
    inReplyTo: null,
    references: [],
    from: sender,
    subject: "",
    text: "",
    attachments: [],
    authResults: authFor(overrides.from ?? sender),
    automated: false,
    ...overrides,
  };
}

/** A reply to our last outbound message, quoting it Gmail-style. */
function replyToLast(text: string, extra: Partial<InboundEmail> = {}): InboundEmail {
  const last = outbox[outbox.length - 1];
  const quoted = last.text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  return email({
    subject: last.subject,
    inReplyTo: last.messageId,
    references: [...(last.references ?? []), last.messageId],
    text: `${text}\n\nOn Tue, 7 Oct 2026 at 10:00, ClaimFlow Claims <claims@claimflow.test> wrote:\n${quoted}`,
    ...extra,
  });
}

const bill = { filename: "bill.pdf", contentType: "application/pdf", content: Buffer.from("%PDF-1.4 test"), size: 13 };

beforeAll(async () => {
  emailIntakeDeps.send = async (m) => {
    outbox.push(m);
  };
  emailIntakeDeps.extract = async () => aiResult;
  emailIntakeDeps.storeDocument = async (a) => ({ name: a.filename, url: `http://minio.test/${a.filename}`, contentType: a.contentType, size: a.size });
  const { rows } = await pool.query(
    `INSERT INTO policies (policy_number, carrier_id, policyholder_name, policyholder_email, status, effective_date, expiry_date, premium_amount, coverage_amount)
     VALUES ($1, gen_random_uuid(), 'Sara Khan', $2, 'active', '2026-01-01', '2027-01-01', 100, 5000) RETURNING id`,
    [policyNumber, sender]
  );
  policyId = rows[0].id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM email_intake_events WHERE sender_email = ANY($1)`, [[sender, stranger]]);
  await pool.query(`DELETE FROM email_claim_drafts WHERE sender_email = $1`, [sender]);
  await pool.query(`DELETE FROM claim_documents WHERE claim_id IN (SELECT id FROM claims WHERE policy_id = $1)`, [policyId]);
  await pool.query(`DELETE FROM claims WHERE policy_id = $1`, [policyId]);
  await pool.query(`DELETE FROM providers WHERE npi = $1`, [npi]);
  await pool.query(`DELETE FROM policies WHERE id = $1`, [policyId]);
  await pool.end();
});

beforeEach(() => {
  aiResult = null;
});

async function lastDraft() {
  const { rows } = await pool.query(`SELECT * FROM email_claim_drafts WHERE sender_email = $1 ORDER BY created_at DESC LIMIT 1`, [sender]);
  return rows[0];
}

describe("sender checks", () => {
  it("replies once to an unknown sender, then stays quiet for 24h", async () => {
    const before = outbox.length;
    await processInboundEmail(email({ from: stranger, text: "raise a claim" }));
    await processInboundEmail(email({ from: stranger, text: "raise a claim" }));
    expect(outbox.length).toBe(before + 1);
    expect(outbox[outbox.length - 1].text).toContain("isn't linked to a ClaimFlow policy");
  });

  it("drops a forged email without replying", async () => {
    const before = outbox.length;
    await processInboundEmail(email({ text: "raise a claim", authResults: ["mx.google.com; dmarc=fail header.from=claimflow.test"] }));
    expect(outbox.length).toBe(before);
    const { rows } = await pool.query(`SELECT action FROM email_intake_events WHERE sender_email = $1 ORDER BY created_at DESC LIMIT 1`, [sender]);
    expect(rows[0].action).toBe("dropped-unauthenticated");
  });

  it("ignores a redelivered Message-ID", async () => {
    const before = outbox.length;
    const once = email({ text: "hi" });
    await processInboundEmail(once);
    await processInboundEmail(once);
    expect(outbox.length).toBe(before + 1);
    expect(outbox[outbox.length - 1].text).toContain("RAISE A CLAIM");
  });
});

describe("raise a claim via the form", () => {
  it("sends a blank form pre-filled with the policy and name", async () => {
    await processInboundEmail(email({ subject: "raise a claim", text: "" }));
    const reply = outbox[outbox.length - 1];
    expect(reply.to).toBe(sender);
    expect(reply.subject).toBe("Re: raise a claim");
    expect(reply.text).toContain(`Policy number (yours: ${policyNumber}): ${policyNumber}`);
    expect(reply.text).toContain("Your full name: Sara Khan");
    expect((await lastDraft()).status).toBe("collecting");
  });

  it("reads the returned form, keeps good answers and flags the bad NPI", async () => {
    const form = outbox[outbox.length - 1].text;
    const filled = form
      .replace("Claim type (outpatient/inpatient/pharmacy/dental/maternity/other):", "Claim type (outpatient/inpatient/pharmacy/dental/maternity/other): outpatient")
      .replace("Incident date (e.g. 03/10/2026, 3 Oct 2026, today):", "Incident date (e.g. 03/10/2026, 3 Oct 2026, today): 03/10/2026")
      .replace("What happened:", "What happened: ER visit for a chest infection")
      .replace("Claim amount (USD):", "Claim amount (USD): 1200")
      .replace("Diagnosis code (ICD-10, e.g. J18.9, on your bill):", "Diagnosis code (ICD-10, e.g. J18.9, on your bill): J18.9")
      .replace("Procedure code (CPT or HCPCS, e.g. 99284, on your bill):", "Procedure code (CPT or HCPCS, e.g. 99284, on your bill): 99284")
      .replace("Service date from (first day of treatment):", "Service date from (first day of treatment): 3 Oct 2026")
      .replace("Total billed (USD, the provider's full bill):", "Total billed (USD, the provider's full bill): $1,200")
      .replace("Provider NPI (10 digits):", "Provider NPI (10 digits): 123456789")
      .replace("Provider tax ID:", "Provider tax ID: 12-3456789")
      .replace("Facility name:", "Facility name: City Hospital")
      .replace("Facility address:", "Facility address: 1 Main St")
      .replace("Other insurance? (yes/no):", "Other insurance? (yes/no): no")
      .replace("I confirm this is accurate (yes/no):", "I confirm this is accurate (yes/no): yes");
    // Claimant edits inside the quoted form (no new text above it).
    const last = outbox[outbox.length - 1];
    await processInboundEmail(
      email({
        subject: last.subject,
        inReplyTo: last.messageId,
        references: [last.messageId],
        text: `Filled in.\n\n${filled.split("\n").map((l) => `> ${l}`).join("\n")}`,
        attachments: [bill],
      })
    );
    const draft = await lastDraft();
    expect(draft.collected_fields).toMatchObject({
      claimType: "outpatient",
      incidentDate: "2026-10-03",
      serviceDateFrom: "2026-10-03",
      claimAmount: 1200,
      totalBilledAmount: 1200,
      coordinationOfBenefits: false,
      attested: true,
    });
    expect(draft.invalid_fields.providerNpi.error).toBe("Provider NPI must be exactly 10 digits.");
    expect(draft.documents).toHaveLength(1);
    expect(draft.status).toBe("collecting");
    const reply = outbox[outbox.length - 1].text;
    expect(reply).toContain("⚠ Provider NPI (10 digits): 123456789\n   → Provider NPI must be exactly 10 digits.");
    expect(reply).toContain("Documents received: bill.pdf");
  });

  it("takes a corrected NPI from free text via the AI, then asks for CONFIRM", async () => {
    aiResult = { model: "test-model", fields: { providerNpi: { value: npi, confidence: "high", source: "text", correction: true } } };
    await processInboundEmail(replyToLast(`Sorry, the NPI is ${npi}.`));
    const draft = await lastDraft();
    expect(draft.collected_fields.providerNpi).toBe(npi);
    expect(draft.invalid_fields).toEqual({});
    expect(draft.status).toBe("awaiting_confirmation");
    expect(outbox[outbox.length - 1].text).toContain("Reply CONFIRM to submit it.");
    const { rows } = await pool.query(`SELECT detail FROM email_intake_events WHERE draft_id = $1 AND action = 'ai-extraction'`, [draft.id]);
    expect(rows.at(-1).detail).toMatchObject({ model: "test-model", fields: { providerNpi: { outcome: "accepted" } } });
  });

  it("an untouched quoted form doesn't undo anything", async () => {
    const before = await lastDraft();
    await processInboundEmail(replyToLast("Looks right to me."));
    const after = await lastDraft();
    expect(after.collected_fields).toEqual(before.collected_fields);
    expect(after.status).toBe("awaiting_confirmation");
  });

  it("CONFIRM raises the claim on the email channel", async () => {
    await processInboundEmail(replyToLast("CONFIRM"));
    const draft = await lastDraft();
    expect(draft.status).toBe("submitted");
    const { rows } = await pool.query(`SELECT * FROM claims WHERE id = $1`, [draft.claim_id]);
    expect(rows[0]).toMatchObject({ channel: "email", claimant_email: sender, claimant_name: "Sara Khan", policy_number: policyNumber, procedure_code: "99284" });
    const audit = await pool.query(`SELECT action, actor_type, detail FROM audit_log WHERE claim_id = $1 ORDER BY created_at`, [draft.claim_id]);
    expect(audit.rows.map((r) => r.action)).toEqual(expect.arrayContaining(["submitted", "email-intake-confirmed"]));
    expect(audit.rows.find((r) => r.action === "submitted").detail.source).toBe("email-intake");
    expect(audit.rows.find((r) => r.action === "email-intake-confirmed")).toMatchObject({ actor_type: "human", detail: { draftId: draft.id } });
    expect(outbox[outbox.length - 1].text).toContain(`reference #${String(draft.claim_id).slice(0, 8)}`);
  });

  it("the claim then shows up under CLAIM STATUS", async () => {
    const draft = await lastDraft();
    await processInboundEmail(email({ subject: "claim status", text: "" }));
    expect(outbox[outbox.length - 1].text).toContain(`#${String(draft.claim_id).slice(0, 8)} · Submitted`);
    await processInboundEmail(email({ text: `status #${String(draft.claim_id).slice(0, 8)}` }));
    expect(outbox[outbox.length - 1].text).toContain("Progress: Submitted");
  });
});

describe("a described claim, rejected at submit", () => {
  it("starts from free text + attachment, and re-asks only the field createClaim() rejects", async () => {
    aiResult = {
      model: "test-model",
      fields: {
        claimType: { value: "outpatient", confidence: "high", source: "text" },
        incidentDate: { value: "2026-10-01", confidence: "high", source: "text" },
        incidentDescription: { value: "Broke my arm", confidence: "high", source: "text" },
        claimAmount: { value: "9000", confidence: "high", source: "text" },
        diagnosisCode: { value: "S52.5", confidence: "high", source: "attachment" },
        procedureCode: { value: "25600", confidence: "high", source: "attachment" },
        serviceDateFrom: { value: "2026-10-01", confidence: "high", source: "text" },
        totalBilledAmount: { value: "9000", confidence: "high", source: "attachment" },
        providerNpi: { value: npi, confidence: "high", source: "attachment" },
        providerTaxId: { value: "12-3456789", confidence: "high", source: "attachment" },
        facilityName: { value: "City Hospital", confidence: "high", source: "text" },
        facilityAddress: { value: "1 Main St", confidence: "high", source: "attachment" },
        coordinationOfBenefits: { value: "no", confidence: "high", source: "text" },
        // Never taken from the AI.
        attested: { value: "yes", confidence: "high", source: "text" },
      },
    };
    await processInboundEmail(
      email({
        subject: "Broken arm",
        text: "Hi, I broke my arm on 1 Oct and went to City Hospital, the bill was $9,000. I have no other insurance. Bill attached.",
        attachments: [bill],
      })
    );
    let draft = await lastDraft();
    expect(draft.collected_fields.attested).toBeUndefined();
    expect(draft.low_confidence_fields).toEqual(expect.arrayContaining(["diagnosisCode", "procedureCode", "providerNpi"]));
    let reply = outbox[outbox.length - 1].text;
    expect(reply).toContain("? Diagnosis code (ICD-10, e.g. J18.9, on your bill): S52.5");
    expect(reply).toContain("⚠ I confirm this is accurate (yes/no):\n   → Still needed.");

    aiResult = null;
    const form = reply.replace("⚠ I confirm this is accurate (yes/no):", "I confirm this is accurate (yes/no): yes");
    const last = outbox[outbox.length - 1];
    await processInboundEmail(email({ subject: last.subject, inReplyTo: last.messageId, references: [last.messageId], text: form }));
    draft = await lastDraft();
    expect(draft.status).toBe("awaiting_confirmation");
    // Returning the form counts as checking the "?" lines.
    expect(draft.low_confidence_fields).toEqual([]);

    // 9000 is over the policy's 5000 coverage — createClaim() rejects claimAmount.
    await processInboundEmail(replyToLast("confirm"));
    draft = await lastDraft();
    expect(draft.status).toBe("collecting");
    expect(draft.collected_fields.claimAmount).toBeUndefined();
    expect(draft.invalid_fields.claimAmount.error).toContain("coverage amount");
    expect(draft.collected_fields.providerNpi).toBe(npi);
    reply = outbox[outbox.length - 1].text;
    expect(reply).toContain("⚠ Claim amount (USD): 9000");
  });

  it("CANCEL discards the draft", async () => {
    await processInboundEmail(replyToLast("Cancel"));
    expect((await lastDraft()).status).toBe("abandoned");
  });
});

describe("IMAP message → InboundEmail", () => {
  it("reads threading, auth headers, attachments and the automated flag from a raw email", async () => {
    const { simpleParser } = await import("mailparser");
    const { toInboundEmail } = await import("../src/email-intake-poller");
    const raw = [
      "Authentication-Results: mx.google.com;",
      "       dkim=pass header.i=@gmail.com;",
      "       dmarc=pass (p=NONE) header.from=gmail.com",
      "Authentication-Results: evil.example; dmarc=pass",
      "From: Sara Khan <Sara@Gmail.com>",
      "To: claims@claimflow.test",
      "Subject: Re: raise a claim",
      "Message-ID: <reply-1@mail.gmail.com>",
      "In-Reply-To: <ours-1@claimflow.test>",
      "References: <first@mail.gmail.com> <ours-1@claimflow.test>",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "NPI is 1234567890",
      "--b1",
      'Content-Type: application/pdf; name="bill.pdf"',
      'Content-Disposition: attachment; filename="bill.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from("%PDF-1.4").toString("base64"),
      "--b1--",
      "",
    ].join("\r\n");
    const inbound = toInboundEmail(await simpleParser(Buffer.from(raw)));
    expect(inbound).toMatchObject({
      messageId: "<reply-1@mail.gmail.com>",
      inReplyTo: "<ours-1@claimflow.test>",
      references: ["<first@mail.gmail.com>", "<ours-1@claimflow.test>"],
      from: "Sara@Gmail.com",
      subject: "Re: raise a claim",
      automated: false,
    });
    expect(inbound.text.trim()).toBe("NPI is 1234567890");
    expect(inbound.attachments.map((a) => [a.filename, a.contentType])).toEqual([["bill.pdf", "application/pdf"]]);
    expect(inbound.authResults[0]).toBe("mx.google.com; dkim=pass header.i=@gmail.com; dmarc=pass (p=NONE) header.from=gmail.com");

    const ooo = toInboundEmail(await simpleParser(Buffer.from("From: a@b.com\r\nAuto-Submitted: auto-replied\r\nSubject: Out of office\r\n\r\nAway")));
    expect(ooo.automated).toBe(true);
  });
});

describe("shared inbox and end date", () => {
  it("only claims mail sent to the +claims address", async () => {
    const { simpleParser } = await import("mailparser");
    const { isAddressedTo } = await import("../src/email-intake-poller");
    const mail = (headers: string) => simpleParser(Buffer.from(`${headers}\r\nFrom: a@b.com\r\nSubject: x\r\n\r\nbody`));
    const claims = "me+claims@gmail.com";
    expect(isAddressedTo(await mail("To: Me <Me+Claims@gmail.com>"), claims)).toBe(true);
    expect(isAddressedTo(await mail("To: other@x.com\r\nCc: me+claims@gmail.com"), claims)).toBe(true);
    expect(isAddressedTo(await mail("Delivered-To: me+claims@gmail.com\r\nTo: undisclosed-recipients:;"), claims)).toBe(true);
    expect(isAddressedTo(await mail("Delivered-To: me@gmail.com\r\nTo: me@gmail.com"), claims)).toBe(false);
  });

  it("stops after EMAIL_INTAKE_UNTIL, inclusive of that day", async () => {
    const { intakeEndPassed } = await import("../src/email-intake-poller");
    const saved = process.env.EMAIL_INTAKE_UNTIL;
    try {
      delete process.env.EMAIL_INTAKE_UNTIL;
      expect(intakeEndPassed(new Date(2030, 0, 1))).toBe(false);
      process.env.EMAIL_INTAKE_UNTIL = "2026-10-21";
      expect(intakeEndPassed(new Date(2026, 9, 21, 23, 0))).toBe(false);
      expect(intakeEndPassed(new Date(2026, 9, 22, 0, 1))).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.EMAIL_INTAKE_UNTIL;
      else process.env.EMAIL_INTAKE_UNTIL = saved;
    }
  });
});

describe("reminders and expiry", () => {
  it("reminds after 3 quiet days and expires after 14", async () => {
    await processInboundEmail(email({ subject: "new claim", text: "" }));
    const draft = await lastDraft();
    await pool.query(`UPDATE email_claim_drafts SET last_inbound_at = now() - interval '4 days' WHERE id = $1`, [draft.id]);
    let before = outbox.length;
    await sweepDrafts();
    const reminders = outbox.slice(before).filter((m) => m.to === sender);
    expect(reminders).toHaveLength(1);
    expect(reminders[0].text).toContain("Reminder: your claim isn't submitted yet");
    before = outbox.length;
    await sweepDrafts();
    expect(outbox.slice(before).filter((m) => m.to === sender)).toHaveLength(0);

    await pool.query(`UPDATE email_claim_drafts SET last_inbound_at = now() - interval '15 days' WHERE id = $1`, [draft.id]);
    await sweepDrafts();
    expect((await lastDraft()).status).toBe("expired");
    expect(outbox[outbox.length - 1].text).toContain("this draft has closed");
  });
});
