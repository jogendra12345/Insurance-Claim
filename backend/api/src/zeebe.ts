import { Zeebe } from "@camunda8/sdk";

// generic/process-orchestration-kickoff.md — the lightweight local Camunda
// stack runs its API unprotected (no Identity/Keycloak), so the client needs
// no credentials; CAMUNDA_AUTH_STRATEGY=NONE and ZEEBE_ADDRESS come from
// backend/api/.env and are read by the SDK itself, not passed here.
export const zeebeClient = new Zeebe.ZeebeGrpcClient();

export const CLAIM_CASE_PROCESS_ID = "claim-case-process";
