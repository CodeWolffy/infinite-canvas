import { and, eq, isNull, lte } from "drizzle-orm";
import { db } from "./db/client.js";
import { config } from "./config.js";
import {
  assets,
  canvasProjectMedia,
  generatedImages,
  generationBatchMedia,
  mediaObjects,
  messageMedia,
} from "./db/schema.js";
import { minio } from "./media.js";

export async function removeUnreferencedMedia(
  mediaIds: string[],
  reportError: (error: unknown, mediaId: string) => void,
) {
  for (const mediaId of [...new Set(mediaIds)]) {
    try {
      const mediaToDelete = await db.transaction(async (tx) => {
        const [claimed] = await tx
          .update(mediaObjects)
          .set({ status: "deleting" })
          .where(and(eq(mediaObjects.id, mediaId), eq(mediaObjects.status, "ready")))
          .returning();
        if (!claimed) return undefined;
        const [[asset], [generated], [canvas], [batch], [message]] = await Promise.all([
          tx.select({ id: assets.id }).from(assets).where(eq(assets.mediaId, mediaId)).limit(1),
          tx.select({ id: generatedImages.id }).from(generatedImages).where(eq(generatedImages.mediaId, mediaId)).limit(1),
          tx.select({ id: canvasProjectMedia.projectId }).from(canvasProjectMedia).where(eq(canvasProjectMedia.mediaId, mediaId)).limit(1),
          tx.select({ id: generationBatchMedia.batchId }).from(generationBatchMedia).where(eq(generationBatchMedia.mediaId, mediaId)).limit(1),
          tx.select({ id: messageMedia.messageId }).from(messageMedia).where(eq(messageMedia.mediaId, mediaId)).limit(1),
        ]);
        if (asset || generated || canvas || batch || message) {
          await tx.update(mediaObjects).set({ status: "ready" }).where(eq(mediaObjects.id, mediaId));
          return undefined;
        }
        await tx.delete(mediaObjects).where(and(eq(mediaObjects.id, mediaId), eq(mediaObjects.status, "deleting")));
        return claimed;
      });
      if (!mediaToDelete) continue;
      await minio.removeObject(mediaToDelete.bucket, mediaToDelete.objectKey);
    } catch (error) {
      reportError(error, mediaId);
    }
  }
}

export async function cleanupOrphanMedia(reportError: (error: unknown, mediaId: string) => void) {
  const cutoff = new Date(Date.now() - config.ORPHAN_MEDIA_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: mediaObjects.id })
    .from(mediaObjects)
    .leftJoin(assets, eq(assets.mediaId, mediaObjects.id))
    .leftJoin(canvasProjectMedia, eq(canvasProjectMedia.mediaId, mediaObjects.id))
    .leftJoin(generatedImages, eq(generatedImages.mediaId, mediaObjects.id))
    .leftJoin(generationBatchMedia, eq(generationBatchMedia.mediaId, mediaObjects.id))
    .leftJoin(messageMedia, eq(messageMedia.mediaId, mediaObjects.id))
    .where(
      and(
        eq(mediaObjects.status, "ready"),
        eq(mediaObjects.referenceCount, 0),
        lte(mediaObjects.createdAt, cutoff),
        isNull(assets.id),
        isNull(canvasProjectMedia.projectId),
        isNull(generatedImages.id),
        isNull(generationBatchMedia.batchId),
        isNull(messageMedia.messageId),
      ),
    )
    .limit(500);
  await removeUnreferencedMedia(rows.map((row) => row.id), reportError);
  return rows.length;
}

export function startOrphanCleanup(reportError: (error: unknown, mediaId: string) => void) {
  const run = () => {
    void cleanupOrphanMedia(reportError).catch(() => undefined);
  };
  run();
  return setInterval(run, 24 * 60 * 60 * 1000);
}

export function stopOrphanCleanup(timer: ReturnType<typeof setInterval>) {
  clearInterval(timer);
}
