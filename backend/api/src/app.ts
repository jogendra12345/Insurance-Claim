import "dotenv/config";
import cors from "cors";
import express from "express";
import { attachUser } from "./auth";
import { assistantRouter } from "./routes/assistant";
import { authRouter } from "./routes/auth";
import { claimsRouter } from "./routes/claims";
import { policiesRouter } from "./routes/policies";
import { providersRouter } from "./routes/providers";
import { tasksRouter } from "./routes/tasks";
import { whatsappRouter } from "./routes/whatsapp";


// The Express app without a listening port — index.ts starts it; tests
// import it directly (supertest).
export const app = express();

// No credentials: sessions are a bearer token in the Authorization header,
// not a cookie (auth-role-based-access.md addendum 2026-10-05), so CORS only
// has to allow that header from the portal's origin.
app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
// Keep the raw body bytes — POST /api/whatsapp/webhook verifies Meta's
// X-Hub-Signature-256 HMAC over exactly what Meta sent, not re-serialized JSON.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  })
);
app.use(attachUser);

app.use("/api/auth", authRouter);
app.use("/api/policies", policiesRouter);
app.use("/api/claims", claimsRouter);
app.use("/api/providers", providersRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/whatsapp", whatsappRouter);
app.use("/api/assistant", assistantRouter);
