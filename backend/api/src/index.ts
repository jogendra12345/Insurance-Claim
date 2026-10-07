import { app } from "./app";
import { startEmailIntakePoller } from "./email-intake-poller";
import { ensureBucket } from "./storage";

const port = Number(process.env.PORT ?? 4000);

// When Camunda drops a REST connection mid-retry, the SDK's HTTP client (got)
// throws this from a timer, outside any request's try/catch — which killed
// the whole API (policies, claims, everything) whenever Camunda went down
// (2026-10-07). The request itself has already failed and been answered, so
// only this exact error is logged and survived; anything else still exits.
process.on("uncaughtException", (err) => {
  if (err instanceof Error && err.message.includes("`onCancel` handler was attached after the promise settled")) {
    console.warn("Ignored a Camunda client retry error (Camunda unreachable?):", err.message);
    return;
  }
  console.error("Uncaught exception, exiting:", err);
  process.exit(1);
});

ensureBucket()
  .then(() => {
    app.listen(port, () => {
      console.log(`backend/api listening on http://localhost:${port}`);
    });
    startEmailIntakePoller();
  })
  .catch((err) => {
    console.error("Failed to prepare MinIO bucket, not starting:", err);
    process.exit(1);
  });
