import { Client } from "minio";

export const BUCKET = process.env.MINIO_BUCKET ?? "claim-documents";

export const minioClient = new Client({
  endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
  port: Number(process.env.MINIO_PORT ?? 9000),
  useSSL: false,
  accessKey: process.env.MINIO_ROOT_USER ?? "claimflow",
  secretKey: process.env.MINIO_ROOT_PASSWORD ?? "claimflow123",
});

// generic/object-storage-provisioning.md: bucket creation happens on API
// startup rather than a separate compose init container, and the bucket is
// public-read (matches this app's no-auth-anywhere-yet posture, §2).
export async function ensureBucket(): Promise<void> {
  const exists = await minioClient.bucketExists(BUCKET).catch(() => false);
  if (!exists) {
    await minioClient.makeBucket(BUCKET);
  }

  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { AWS: ["*"] },
        Action: ["s3:GetObject"],
        Resource: [`arn:aws:s3:::${BUCKET}/*`],
      },
    ],
  };
  await minioClient.setBucketPolicy(BUCKET, JSON.stringify(policy));
}

export function publicUrl(objectKey: string): string {
  const endpoint = process.env.MINIO_ENDPOINT ?? "localhost";
  const port = process.env.MINIO_PORT ?? "9000";
  return `http://${endpoint}:${port}/${BUCKET}/${objectKey}`;
}
