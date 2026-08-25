import { pool } from "./db";

export type AuditActorType = "system" | "ai" | "human";

export interface AuditLogEntry {
  claimId: string;
  actorType: AuditActorType;
  actorId: string;
  action: string;
  detail?: unknown;
}

// SPEC.md §13 — every job worker, and every user-task completion, writes
// exactly one audit_log row.
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log (claim_id, actor_type, actor_id, action, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      entry.claimId,
      entry.actorType,
      entry.actorId,
      entry.action,
      entry.detail !== undefined ? JSON.stringify(entry.detail) : null,
    ]
  );
}
