import { Router } from "express";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";

export const mediaRouter = Router();

/**
 * Returns a presigned upload URL for attachments (images, video, voice
 * notes). Stubbed: wire this to S3 (or Firebase Storage / GCS) once you
 * have a bucket. Example with the AWS SDK:
 *
 *   npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
 *
 *   const url = await getSignedUrl(s3, new PutObjectCommand({
 *     Bucket: process.env.MEDIA_BUCKET,
 *     Key: `uploads/${req.userId}/${randomUUID()}-${req.body.filename}`,
 *     ContentType: req.body.contentType,
 *   }), { expiresIn: 900 });
 */
mediaRouter.post("/presign", requireAuth, async (req: AuthedRequest, res) => {
  const { filename, contentType } = req.body ?? {};
  if (!filename || !contentType) {
    return res.status(400).json({ error: "filename and contentType are required" });
  }
  return res.status(501).json({
    error: "Media storage not configured",
    hint: "Wire this endpoint to S3/GCS/Firebase Storage — see the comment above mediaRouter.post('/presign', ...) in src/routes/media.ts",
  });
});
