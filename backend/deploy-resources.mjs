

import { Zeebe } from "@camunda8/sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.ZEEBE_GRPC_ADDRESS = process.env.ZEEBE_GRPC_ADDRESS || "grpc://localhost:26500";
process.env.CAMUNDA_AUTH_STRATEGY = process.env.CAMUNDA_AUTH_STRATEGY || "NONE";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const processDir = path.join(repoRoot, "process");
const formsDir = path.join(processDir, "forms");

const zeebeClient = new Zeebe.ZeebeGrpcClient();

const resources = [
  { processFilename: path.join(processDir, "claim-case-process.bpmn") },
  { decisionFilename: path.join(processDir, "health-claim-routing.dmn") },
  { form: fs.readFileSync(path.join(formsDir, "review-decision.form")), name: "review-decision.form" },
  { form: fs.readFileSync(path.join(formsDir, "triage-review.form")), name: "triage-review.form" },
  { form: fs.readFileSync(path.join(formsDir, "validation-exception-review.form")), name: "validation-exception-review.form" },
];

const result = await zeebeClient.deployResources(resources);
console.log(JSON.stringify(result, null, 2));
await zeebeClient.close();
