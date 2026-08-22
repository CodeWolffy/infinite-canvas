import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, eq, or, sql } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import { imageSize } from "image-size";
import { z } from "zod";
import { authenticate } from "../auth/session.js";
import { config } from "../config.js";
import { db } from "../db/client.js";
import {
  assets,
  canvasProjectMedia,
  canvasProjects,
  generatedImages,
  generationBatchMedia,
  generationBatches,
  mediaObjects,
  messageMedia,
  messages,
  conversations,
} from "../db/schema.js";
import { minio } from "../media.js";

const paramsSchema = z.object({ id: z.string().uuid() });
const supportedMime = new Set(["image/png", "image/jpeg", "image/webp"]);

function serializeMedia(media: typeof mediaObjects.$inferSelect) {
  return {
    id: media.id,
    originalName: media.originalName,
    mimeType: media.mimeType,
    byteSize: media.byteSize,
    width: media.width,
    height: media.height,
    createdAt: media.createdAt,
    url: `/api/media/${media.id}`,
  };
}

export async function mediaRoutes(app: FastifyInstance) {
  app.get("/stats", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    const [row] = await db
      .select({
        totalCount: sql<number>`count(*)::int`,
        totalBytes: sql<number>`coalesce(sum(${mediaObjects.byteSize}), 0)::float8`,
      })
      .from(mediaObjects)
      .where(and(eq(mediaObjects.ownerId, user.id), eq(mediaObjects.status, "ready")));
    return { totalCount: Number(row?.totalCount ?? 0), totalBytes: Number(row?.totalBytes ?? 0) };
  });

  app.post("/", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "file_required", message: "请选择图片文件" });
    const buffer = await file.toBuffer();
    if (buffer.length > config.MAX_UPLOAD_BYTES) {
      return reply.code(413).send({ error: "file_too_large", message: "图片超过上传大小限制" });
    }
    const detected = await fileTypeFromBuffer(buffer);
    if (!detected || !supportedMime.has(detected.mime)) {
      return reply.code(415).send({ error: "unsupported_media_type", message: "仅支持 PNG、JPEG 和 WebP" });
    }
    const dimensions = imageSize(buffer);

    const now = new Date();
    const objectKey = `users/${user.id}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${detected.ext}`;
    await minio.putObject(config.MINIO_BUCKET, objectKey, buffer, buffer.length, {
      "Content-Type": detected.mime,
    });

    try {
      const [media] = await db
        .insert(mediaObjects)
        .values({
          ownerId: user.id,
          bucket: config.MINIO_BUCKET,
          objectKey,
          originalName: file.filename.slice(0, 255),
          mimeType: detected.mime,
          byteSize: buffer.length,
          width: dimensions.width,
          height: dimensions.height,
          sha256: createHash("sha256").update(buffer).digest("hex"),
        })
        .returning();
      return reply.code(201).send({ media: serializeMedia(media!) });
    } catch (error) {
      await minio.removeObject(config.MINIO_BUCKET, objectKey);
      throw error;
    }
  });

  app.get("/:id", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    const { id } = paramsSchema.parse(request.params);
    const [media] = await db.select().from(mediaObjects).where(eq(mediaObjects.id, id)).limit(1);
    if (!media || media.status !== "ready") {
      return reply.code(404).send({ error: "not_found", message: "文件不存在" });
    }
    if (media.ownerId !== user.id && user.role !== "admin") {
      const [[assetReference], [canvasReference], [batchReference], [messageReference]] = await Promise.all([
        db
          .select({ id: assets.id })
          .from(assets)
          .where(and(eq(assets.mediaId, media.id), or(eq(assets.scope, "public"), eq(assets.ownerId, user.id))))
          .limit(1),
        db
          .select({ id: canvasProjectMedia.projectId })
          .from(canvasProjectMedia)
          .innerJoin(canvasProjects, eq(canvasProjects.id, canvasProjectMedia.projectId))
          .where(and(eq(canvasProjectMedia.mediaId, media.id), eq(canvasProjects.userId, user.id)))
          .limit(1),
        db
          .select({ id: generationBatchMedia.batchId })
          .from(generationBatchMedia)
          .innerJoin(generationBatches, eq(generationBatches.id, generationBatchMedia.batchId))
          .where(and(eq(generationBatchMedia.mediaId, media.id), eq(generationBatches.userId, user.id)))
          .limit(1),
        db
          .select({ id: messageMedia.messageId })
          .from(messageMedia)
          .innerJoin(messages, eq(messages.id, messageMedia.messageId))
          .innerJoin(conversations, eq(conversations.id, messages.conversationId))
          .where(and(eq(messageMedia.mediaId, media.id), eq(conversations.userId, user.id)))
          .limit(1),
      ]);
      if (!assetReference && !canvasReference && !batchReference && !messageReference) {
        return reply.code(403).send({ error: "forbidden", message: "无权访问该文件" });
      }
    }

    const stream = await minio.getObject(media.bucket, media.objectKey);
    reply.header("Content-Type", media.mimeType);
    reply.header("Content-Length", String(media.byteSize));
    reply.header("Cache-Control", "private, max-age=3600");
    return reply.send(stream);
  });

  app.delete("/:id", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    const { id } = paramsSchema.parse(request.params);
    const [media] = await db.select().from(mediaObjects).where(eq(mediaObjects.id, id)).limit(1);
    if (!media || media.status !== "ready") {
      return reply.code(404).send({ error: "not_found", message: "文件不存在" });
    }
    if (media.ownerId !== user.id && user.role !== "admin") {
      return reply.code(403).send({ error: "forbidden", message: "无权删除该文件" });
    }
    const [[assetReference], [generatedReference], [canvasReference], [batchReference], [messageReference]] = await Promise.all([
      db.select({ id: assets.id }).from(assets).where(eq(assets.mediaId, id)).limit(1),
      db.select({ id: generatedImages.id }).from(generatedImages).where(eq(generatedImages.mediaId, id)).limit(1),
      db.select({ id: canvasProjectMedia.projectId }).from(canvasProjectMedia).where(eq(canvasProjectMedia.mediaId, id)).limit(1),
      db.select({ id: generationBatchMedia.batchId }).from(generationBatchMedia).where(eq(generationBatchMedia.mediaId, id)).limit(1),
      db.select({ id: messageMedia.messageId }).from(messageMedia).where(eq(messageMedia.mediaId, id)).limit(1),
    ]);
    if (
      media.referenceCount > 0 ||
      assetReference ||
      generatedReference ||
      canvasReference ||
      batchReference ||
      messageReference
    ) {
      return reply.code(409).send({ error: "media_in_use", message: "文件仍被业务数据引用" });
    }

    const [claimed] = await db
      .update(mediaObjects)
      .set({ status: "deleting" })
      .where(and(eq(mediaObjects.id, id), eq(mediaObjects.status, "ready"), eq(mediaObjects.referenceCount, 0)))
      .returning();
    if (!claimed) return reply.code(409).send({ error: "media_in_use", message: "文件状态已变化" });
    let objectRemoved = false;
    try {
      await minio.removeObject(media.bucket, media.objectKey);
      objectRemoved = true;
      await db.delete(mediaObjects).where(eq(mediaObjects.id, id));
    } catch (error) {
      if (!objectRemoved) await db.update(mediaObjects).set({ status: "ready" }).where(eq(mediaObjects.id, id));
      throw error;
    }
    return reply.code(204).send();
  });
}
