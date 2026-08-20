import "dotenv/config";
import cors from "cors";
import express from "express";
import { policiesRouter } from "./routes/policies";

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(cors({ origin: process.env.CORS_ORIGIN ?? "http://localhost:3000" }));
app.use(express.json());

app.use("/api/policies", policiesRouter);

app.listen(port, () => {
  console.log(`backend/api listening on http://localhost:${port}`);
});
