import { and, eq, inArray, lt, ne } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  networkingPhotoUploadsTable,
  networkingProfilesTable,
} from "@workspace/db/schema";
import { logger } from "./logger";
import { ObjectNotFoundError, ObjectStorageService } from "./objectStorage";

const PHOTO_UPLOAD_GRACE_PERIOD_MS = 60 * 60 * 1000;
const MAX_CLEANUP_BATCH = 100;
const objectStorage = new ObjectStorageService();

/**
 * Claim an unreferenced upload before deleting it. The deleting state prevents
 * a concurrent profile save from re-attaching the object after this check.
 */
export async function cleanupNetworkingPhotoObject(
  objectPath: string,
  expectedUserId?: string,
): Promise<boolean> {
  const claimed = await db.transaction(async (tx) => {
    const [upload] = await tx.select().from(networkingPhotoUploadsTable)
      .where(and(
        eq(networkingPhotoUploadsTable.objectPath, objectPath),
        ...(expectedUserId ? [eq(networkingPhotoUploadsTable.userId, expectedUserId)] : []),
        ne(networkingPhotoUploadsTable.status, "deleting"),
      ))
      .for("update");
    if (!upload) return null;

    const [profile] = await tx.select({
      photoAssetPath: networkingProfilesTable.photoAssetPath,
    }).from(networkingProfilesTable)
      .where(eq(networkingProfilesTable.userId, upload.userId));
    if (profile?.photoAssetPath === objectPath) return null;

    const [updated] = await tx.update(networkingPhotoUploadsTable)
      .set({ status: "deleting" })
      .where(and(
        eq(networkingPhotoUploadsTable.objectPath, objectPath),
        ne(networkingPhotoUploadsTable.status, "deleting"),
      ))
      .returning({ status: networkingPhotoUploadsTable.status });
    return updated ? { userId: upload.userId, previousStatus: upload.status } : null;
  });

  if (!claimed) return false;
  try {
    await objectStorage.deleteObjectEntity(objectPath);
    await db.delete(networkingPhotoUploadsTable).where(and(
      eq(networkingPhotoUploadsTable.objectPath, objectPath),
      eq(networkingPhotoUploadsTable.status, "deleting"),
    ));
    return true;
  } catch (error) {
    if (!(error instanceof ObjectNotFoundError)) {
      logger.warn({ err: error, objectPath, userId: claimed.userId }, "Failed to delete abandoned networking photo");
    }
    await db.update(networkingPhotoUploadsTable)
      .set({ status: claimed.previousStatus })
      .where(and(
        eq(networkingPhotoUploadsTable.objectPath, objectPath),
        eq(networkingPhotoUploadsTable.status, "deleting"),
      ));
    return false;
  }
}

export async function cleanupAbandonedNetworkingPhotoUploads(): Promise<void> {
  const cutoff = new Date(Date.now() - PHOTO_UPLOAD_GRACE_PERIOD_MS);
  const candidates = await db.select({
    objectPath: networkingPhotoUploadsTable.objectPath,
    userId: networkingPhotoUploadsTable.userId,
  }).from(networkingPhotoUploadsTable)
    .where(and(
      lt(networkingPhotoUploadsTable.createdAt, cutoff),
      inArray(networkingPhotoUploadsTable.status, ["pending", "retired"]),
    ))
    .limit(MAX_CLEANUP_BATCH);

  await Promise.all(candidates.map((candidate) =>
    cleanupNetworkingPhotoObject(candidate.objectPath, candidate.userId),
  ));
}

export function scheduleNetworkingPhotoCleanup(
  objectPath?: string | null,
  userId?: string,
): void {
  setImmediate(() => {
    const cleanup = objectPath
      ? cleanupNetworkingPhotoObject(objectPath, userId)
      : cleanupAbandonedNetworkingPhotoUploads();
    void cleanup.catch((error) => {
      logger.warn({ err: error, objectPath, userId }, "Networking photo cleanup failed");
    });
  });
}