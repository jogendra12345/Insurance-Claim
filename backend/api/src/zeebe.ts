import { CamundaRestClient, Zeebe } from "@camunda8/sdk";

// generic/process-orchestration-kickoff.md — the lightweight local Camunda
// stack runs its API unprotected (no Identity/Keycloak), so the client needs
// no credentials; CAMUNDA_AUTH_STRATEGY=NONE and ZEEBE_ADDRESS come from
// backend/api/.env and are read by the SDK itself, not passed here.
//
// maxRetries is bounded (default is unlimited) because createProcessInstance
// is not idempotent: under broker load, a gRPC call can time out client-side
// (DEADLINE_EXCEEDED) after the command already reached the broker and
// started an instance, and the SDK's automatic retry then starts a *second*
// instance for the same claim once it finally succeeds. Bounding retries
// doesn't eliminate that race (see the post-creation cancellation guard in
// routes/claims.ts, which does), but it stops a struggling broker from being
// hammered by a retry loop that can run for minutes.
export const zeebeClient = new Zeebe.ZeebeGrpcClient({
  config: { zeebeGrpcSettings: { ZEEBE_GRPC_CLIENT_MAX_RETRIES: 5 } },
});

export const camundaRestClient = new CamundaRestClient();

export const CLAIM_CASE_PROCESS_ID = "claim-case-process";
