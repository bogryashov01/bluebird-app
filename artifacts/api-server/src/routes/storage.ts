import { Readable } from "node:stream";
import { RequestUploadUrlBody, RequestUploadUrlResponse } from "@workspace/api-zod";
import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { networkingPhotoUploadsTable } from "@workspace/db/schema";
import { authMiddleware } from "../middlewares/auth";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { scheduleNetworkingPhotoCleanup } from "../lib/networkingPhotoCleanup";

const router = Router();
const storage = new ObjectStorageService();
const MAX_PHOTO_BYTES = 1_500_000;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

router.post("/storage/uploads/request-url", authMiddleware, async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success || !IMAGE_TYPES.has(parsed.data.contentType) || parsed.data.size > MAX_PHOTO_BYTES) {
    return res.status(400).json({ error: "Profile photo must be a JPEG, PNG, or WebP under 1.5 MB" });
  }
  try {
    const { uploadURL, objectPath } = await storage.createObjectEntityUpload();
    try {
      await db.insert(networkingPhotoUploadsTable).values({
        objectPath,
        userId: (req as any).userId as string,
      });
    } catch (error) {
      // No response has been sent yet, so this URL cannot be used by this
      // client. Still remove the object if a direct upload raced this insert.
      void storage.deleteObjectEntity(objectPath).catch((cleanupError) => {
        req.log.warn({ err: cleanupError, objectPath }, "Failed to remove untracked profile photo upload");
      });
      throw error;
    }
    scheduleNetworkingPhotoCleanup();
    return res.json(RequestUploadUrlResponse.parse({
      uploadURL,
      objectPath,
      metadata: parsed.data,
    }));
  } catch (error) {
    req.log.error({ err: error }, "Failed to generate object upload URL");
    return res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const file = await storage.findPublicObject(Array.isArray(raw) ? raw.join("/") : raw);
    if (!file) return res.status(404).json({ error: "File not found" });
    const [metadata] = await file.getMetadata();
    res.setHeader("Content-Type", metadata.contentType ?? "application/octet-stream");
    if (metadata.size) res.setHeader("Content-Length", String(metadata.size));
    return Readable.from(file.createReadStream()).pipe(res);
  } catch (error) {
    req.log.error({ err: error }, "Failed to serve public object");
    return res.status(500).json({ error: "Failed to serve public object" });
  }
});

// Profile photos are intentionally readable by networking participants once
// the profile API has disclosed the opaque object path. The upload URL itself
// remains bearer-token protected.
router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const objectPath = `/objects/${Array.isArray(raw) ? raw.join("/") : raw}`;
    const file = await storage.getObjectEntityFile(objectPath);
    const [metadata] = await file.getMetadata();
    res.setHeader("Content-Type", metadata.contentType ?? "application/octet-stream");
    if (metadata.size) res.setHeader("Content-Length", String(metadata.size));
    return Readable.from(file.createReadStream()).pipe(res);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) return res.status(404).json({ error: "Object not found" });
    req.log.error({ err: error }, "Failed to serve object");
    return res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;