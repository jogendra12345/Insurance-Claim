import "dotenv/config";
import cors from "cors";
import express from "express";
import path from "node:path";
import { claimsRouter } from "./routes/claims";
import { policiesRouter } from "./routes/policies";

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(cors({ origin: process.env.CORS_ORIGIN ?? "http://localhost:3000" }));
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.use("/api/policies", policiesRouter);
app.use("/api/claims", claimsRouter);

app.listen(port, () => {
  console.log(`backend/api listening on http://localhost:${port}`);
});
