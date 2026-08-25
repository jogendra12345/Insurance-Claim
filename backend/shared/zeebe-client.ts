import { Zeebe } from "@camunda8/sdk";

// Mirrors backend/api/src/zeebe.ts. The lightweight local Camunda stack has
// no Identity/Keycloak, so the client needs no credentials —
// ZEEBE_GRPC_ADDRESS and CAMUNDA_AUTH_STRATEGY=NONE come from this package's
// .env and are read by the SDK itself, not passed here.
export const zeebeClient = new Zeebe.ZeebeGrpcClient();
