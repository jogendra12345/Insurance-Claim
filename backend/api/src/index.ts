import "dotenv/config";
import cors from "cors";
import express from "express";
import { claimsRouter } from "./routes/claims";
import { policiesRouter } from "./routes/policies";
import { ensureBucket } from "./storage";

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(cors({ origin: process.env.CORS_ORIGIN ?? "http://localhost:3000" }));
app.use(express.json());

app.use("/api/policies", policiesRouter);
app.use("/api/claims", claimsRouter);

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
