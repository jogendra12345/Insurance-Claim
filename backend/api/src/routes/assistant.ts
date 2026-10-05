import { Router } from "express";
import { requireRole } from "../auth";
import {
  claimProgressLine,
  claimStatusCopy,
  getClaimStatusDetail,
  getClaimStatusList,
  type ClaimStatusSummary,
} from "../claims-assistant";

// Portal chat assistant's read endpoints — .claude/specs/generic/
// portal-claims-assistant.md Decision 4. Claim status comes from the same
// shared layer the WhatsApp bot uses, so both channels describe a claim in
// the same words; the session's email is the identity (Decision 6:
// claimants only). Not audited (Decision 8).

export const assistantRouter = Router();

assistantRouter.use(requireRole("claimant"));

function withStatusCopy<T extends ClaimStatusSummary>(claim: T) {
  const copy = claimStatusCopy(claim.status);
  return { ...claim, statusLabel: copy.label, progress: claimProgressLine(claim.status), next: copy.next };
}

assistantRouter.get("/claims", async (req, res) => {
  try {
    const claims = await getClaimStatusList({ kind: "email", email: req.user!.email });
    res.json(claims.map(withStatusCopy));
  } catch (err) {
    console.error("GET /api/assistant/claims failed:", err);
    res.status(500).json({ message: "Couldn't load your claims." });
  }
});

assistantRouter.get("/claims/:id", async (req, res) => {
  try {
    const detail = await getClaimStatusDetail({ kind: "email", email: req.user!.email }, req.params.id);
    if (!detail) return res.status(404).json({ message: "Claim not found." });
    res.json(withStatusCopy(detail));
  } catch (err) {
    console.error("GET /api/assistant/claims/:id failed:", err);
    res.status(500).json({ message: "Couldn't load that claim." });
  }
});
