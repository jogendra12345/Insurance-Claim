import "dotenv/config";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { attachUser } from "./auth";
import { authRouter } from "./routes/auth";
import { claimsRouter } from "./routes/claims";
import { policiesRouter } from "./routes/policies";
import { providersRouter } from "./routes/providers";
import { tasksRouter } from "./routes/tasks";
import { ensureBucket } from "./storage";

const app = express();
const port = Number(process.env.PORT ?? 4000);

// credentials: true — the session cookie is httpOnly and cross-origin
// (frontend/portal's dev server on :3000 calling this API on :4000), so the
// browser needs the CORS response to explicitly allow it.
app.use(cors({ origin: process.env.CORS_ORIGIN ?? "http://localhost:3000", credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(attachUser);

app.use("/api/auth", authRouter);
app.use("/api/policies", policiesRouter);
app.use("/api/claims", claimsRouter);
app.use("/api/providers", providersRouter);
app.use("/api/tasks", tasksRouter);

ensureBucket()
  .then(() => {
    app.listen(port, () => {
      console.log(`backend/api listening on http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error("Failed to prepare MinIO bucket, not starting:", err);
    process.exit(1);
  });
