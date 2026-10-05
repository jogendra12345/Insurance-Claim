import { app } from "./app";
import { ensureBucket } from "./storage";

const port = Number(process.env.PORT ?? 4000);

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
