import { and, eq } from "drizzle-orm";
import { db } from "./db/client.js";
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
    let objectRemoved = false;
    try {
      const media = await db.transaction(async (tx) => {
        const [claimed] = await tx
          .update(mediaObjects)
          .set({ status: "deleting" })
          .where(and(eq(mediaObjects.id, mediaId), eq(mediaObjects.status, "ready"), eq(mediaObjects.referenceCount, 0)))
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
        return claimed;
      });
      if (!media) continue;
      await minio.removeObject(media.bucket, media.objectKey);
      objectRemoved = true;
      await db.delete(mediaObjects).where(and(eq(mediaObjects.id, mediaId), eq(mediaObjects.status, "deleting")));
    } catch (error) {
      if (!objectRemoved) {
        try {
          await db.update(mediaObjects).set({ status: "ready" }).where(and(eq(mediaObjects.id, mediaId), eq(mediaObjects.status, "deleting")));
        } catch (restoreError) {
          reportError(restoreError, mediaId);
        }
      }
      reportError(error, mediaId);
    }
  }
}
