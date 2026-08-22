import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { authenticate } from "../auth/session.js";
import { hasChannelCandidates, runWithFailover, UpstreamError } from "../channel-scheduler.js";
import { config } from "../config.js";
import { db } from "../db/client.js";
import {
  assets,
  canvasProjectMedia,
  canvasProjects,
  conversations,
  mediaObjects,
  messageMedia,
  messages,
  models,
  textRequests,
} from "../db/schema.js";
import { minio } from "../media.js";
import { generateText } from "../upstream.js";

const supportedAttachmentMime = new Set(["image/png", "image/jpeg", "image/webp"]);
const maxHistoryMessages = 50;

type AttachmentMedia = {
  id: string;
  bucket: string;
  objectKey: string;
  mimeType: string;
  byteSize: number;
};

async function loadAttachmentImages(media: AttachmentMedia[]) {
  return Promise.all(
    media.map(async (item) => {
      const stream = await minio.getObject(item.bucket, item.objectKey);
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of stream) {
        total += chunk.length;
        if (total > config.MAX_UPLOAD_BYTES) {
          throw new UpstreamError("附件图片超过上传限制", "attachment_too_large", undefined, "never");
        }
        chunks.push(Buffer.from(chunk));
      }
      return { buffer: Buffer.concat(chunks), mimeType: item.mimeType };
    }),
  );
}

const createBody = z.object({
  requestId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  canvasProjectId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200).default("新对话"),
  modelId: z.string().uuid(),
  content: z.string().trim().min(1).max(100000),
  attachmentMediaIds: z.array(z.string().uuid()).max(20).default([]),
  parameters: z.record(z.string(), z.unknown()).default({}),
});
const conversationBody = z.object({
  canvasProjectId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200).default("新对话"),
});
const conversationListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function textRoutes(app: FastifyInstance) {
  app.post("/conversations", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    const body = conversationBody.parse(request.body);
    if (body.canvasProjectId) {
      const [canvas] = await db
        .select({ id: canvasProjects.id })
        .from(canvasProjects)
        .where(and(eq(canvasProjects.id, body.canvasProjectId), eq(canvasProjects.userId, user.id)))
        .limit(1);
      if (!canvas) return reply.code(400).send({ error: "invalid_canvas", message: "画布项目不存在" });
    }
    const [conversation] = await db
      .insert(conversations)
      .values({ userId: user.id, canvasProjectId: body.canvasProjectId, title: body.title })
      .returning();
    return reply.code(201).send({ conversation });
  });

  app.post("/requests", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    const body = createBody.parse(request.body);
    const [model] = await db
      .select({ id: models.id })
      .from(models)
      .where(and(eq(models.id, body.modelId), eq(models.capability, "text"), eq(models.status, "published")))
      .limit(1);
    if (!model) return reply.code(400).send({ error: "invalid_model", message: "文本模型不可用" });
    if (!(await hasChannelCandidates(model.id))) {
      return reply.code(503).send({ error: "no_channel", message: "当前模型暂无可用渠道" });
    }
    const attachmentMediaIds = [...new Set(body.attachmentMediaIds)];
    let attachmentMedia: AttachmentMedia[] = [];
    if (attachmentMediaIds.length) {
      const visible = await db
        .selectDistinct({
          id: mediaObjects.id,
          bucket: mediaObjects.bucket,
          objectKey: mediaObjects.objectKey,
          mimeType: mediaObjects.mimeType,
          byteSize: mediaObjects.byteSize,
        })
        .from(mediaObjects)
        .leftJoin(assets, eq(assets.mediaId, mediaObjects.id))
        .leftJoin(canvasProjectMedia, eq(canvasProjectMedia.mediaId, mediaObjects.id))
        .leftJoin(canvasProjects, eq(canvasProjects.id, canvasProjectMedia.projectId))
        .where(
          and(
            inArray(mediaObjects.id, attachmentMediaIds),
            or(eq(mediaObjects.ownerId, user.id), eq(assets.scope, "public"), eq(assets.ownerId, user.id), eq(canvasProjects.userId, user.id)),
            eq(mediaObjects.status, "ready"),
          ),
        );
      if (visible.length !== attachmentMediaIds.length) {
        return reply.code(400).send({ error: "invalid_media", message: "附件不存在或无权访问" });
      }
      if (visible.some((media) => !supportedAttachmentMime.has(media.mimeType) || media.byteSize > config.MAX_UPLOAD_BYTES)) {
        return reply.code(400).send({ error: "invalid_media", message: "附件仅支持 20MB 以内的 PNG、JPEG 或 WebP 图片" });
      }
      const visibleById = new Map(visible.map((media) => [media.id, media]));
      attachmentMedia = attachmentMediaIds.map((id) => visibleById.get(id)!);
    }
    if (!body.conversationId && body.canvasProjectId) {
      const [canvas] = await db
        .select({ id: canvasProjects.id })
        .from(canvasProjects)
        .where(and(eq(canvasProjects.id, body.canvasProjectId), eq(canvasProjects.userId, user.id)))
        .limit(1);
      if (!canvas) return reply.code(400).send({ error: "invalid_canvas", message: "画布项目不存在" });
    }

    if (body.conversationId) {
      const [owned] = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, body.conversationId), eq(conversations.userId, user.id)))
        .limit(1);
      if (!owned) return reply.code(404).send({ error: "not_found", message: "对话不存在" });
    }

    const startedAt = new Date();
    try {
      const created = await db.transaction(async (tx) => {
        let conversationId = body.conversationId;
        if (!conversationId) {
          const [conversation] = await tx
            .insert(conversations)
            .values({ userId: user.id, canvasProjectId: body.canvasProjectId, title: body.title })
            .returning({ id: conversations.id });
          conversationId = conversation!.id;
        }
        const inserted = await tx
          .insert(messages)
          .values({ conversationId, role: "user", content: body.content, attachments: attachmentMediaIds })
          .returning();
        if (attachmentMediaIds.length) {
          const claimed = await tx
            .update(mediaObjects)
            .set({ referenceCount: sql`${mediaObjects.referenceCount} + 1` })
            .where(and(inArray(mediaObjects.id, attachmentMediaIds), eq(mediaObjects.status, "ready")))
            .returning({ id: mediaObjects.id });
          if (claimed.length !== attachmentMediaIds.length) throw new Error("MEDIA_UNAVAILABLE");
          await tx.insert(messageMedia).values(
            attachmentMediaIds.map((mediaId) => ({ messageId: inserted[0]!.id, mediaId })),
          );
        }
        const [textRequest] = await tx
          .insert(textRequests)
          .values({
            id: body.requestId,
            userId: user.id,
            conversationId,
            requestMessageId: inserted[0]!.id,
            modelId: body.modelId,
            status: "running",
            startedAt,
          })
          .returning();
        return { conversationId, requestMessage: inserted[0]!, textRequest: textRequest! };
      });
      const { conversationId, requestMessage, textRequest } = created;

      try {
        const recentMessages = await db
          .select({ id: messages.id, role: messages.role, content: messages.content })
          .from(messages)
          .where(eq(messages.conversationId, conversationId))
          .orderBy(desc(messages.createdAt))
          .limit(maxHistoryMessages);
        const history = recentMessages.reverse();
        const attachmentImages = await loadAttachmentImages(attachmentMedia);
        const upstreamMessages = attachmentImages.length
          ? history.map(({ id, ...message }) =>
              id === requestMessage.id ? { ...message, images: attachmentImages } : message,
            )
          : history.map(({ id: _, ...message }) => message);
        const { result: content, candidate } = await runWithFailover(body.modelId, async (channel) => {
          await db
            .update(textRequests)
            .set({ channelId: channel.channelId, upstreamModel: channel.upstreamModel })
            .where(eq(textRequests.id, textRequest.id));
          return generateText(channel, upstreamMessages, body.parameters);
        });
        const finishedAt = new Date();
        const responseMessage = await db.transaction(async (tx) => {
          const response = await tx
            .insert(messages)
            .values({ conversationId, role: "assistant", content })
            .returning();
          await tx
            .update(textRequests)
            .set({
              responseMessageId: response[0]!.id,
              channelId: candidate.channelId,
              upstreamModel: candidate.upstreamModel,
              status: "succeeded",
              durationMs: finishedAt.getTime() - startedAt.getTime(),
              finishedAt,
            })
            .where(eq(textRequests.id, textRequest.id));
          await tx.update(conversations).set({ updatedAt: finishedAt }).where(eq(conversations.id, conversationId));
          return response[0]!;
        });
        return { conversationId, requestId: textRequest.id, message: responseMessage };
      } catch (error) {
        const upstream = error instanceof UpstreamError ? error : new UpstreamError("文本请求失败", "internal_error");
        const finishedAt = new Date();
        await db
          .update(textRequests)
          .set({ status: "failed", errorCode: upstream.category, durationMs: finishedAt.getTime() - startedAt.getTime(), finishedAt })
          .where(eq(textRequests.id, textRequest.id));
        return reply.code(502).send({ error: upstream.category, message: upstream.message, conversationId, requestId: textRequest.id });
      }
    } catch (error) {
      if (error instanceof Error && error.message === "MEDIA_UNAVAILABLE") {
        return reply.code(400).send({ error: "invalid_media", message: "附件已不可用" });
      }
      throw error;
    }
  });

  app.get("/conversations", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    const { limit, offset } = conversationListQuery.parse(request.query);
    return {
      conversations: await db
        .select()
        .from(conversations)
        .where(eq(conversations.userId, user.id))
        .orderBy(desc(conversations.updatedAt))
        .limit(limit)
        .offset(offset),
    };
  });

  app.get("/conversations/:id", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, user.id)))
      .limit(1);
    if (!conversation) return reply.code(404).send({ error: "not_found", message: "对话不存在" });
    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));
    const [latestRequest] = await db
      .select({ id: textRequests.id, status: textRequests.status, errorCode: textRequests.errorCode, responseMessageId: textRequests.responseMessageId, createdAt: textRequests.createdAt, finishedAt: textRequests.finishedAt })
      .from(textRequests)
      .where(eq(textRequests.conversationId, id))
      .orderBy(desc(textRequests.createdAt))
      .limit(1);
    return { conversation, messages: history, latestRequest: latestRequest ?? null };
  });

  app.get("/requests/:id", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const [textRequest] = await db
      .select({
        id: textRequests.id,
        conversationId: textRequests.conversationId,
        responseMessageId: textRequests.responseMessageId,
        status: textRequests.status,
        errorCode: textRequests.errorCode,
        createdAt: textRequests.createdAt,
        finishedAt: textRequests.finishedAt,
      })
      .from(textRequests)
      .where(and(eq(textRequests.id, id), eq(textRequests.userId, user.id)))
      .limit(1);
    if (!textRequest) return reply.code(404).send({ error: "not_found", message: "文本请求不存在" });
    const [responseMessage] = textRequest.responseMessageId
      ? await db
          .select()
          .from(messages)
          .where(and(eq(messages.id, textRequest.responseMessageId), eq(messages.conversationId, textRequest.conversationId)))
          .limit(1)
      : [];
    return { request: textRequest, message: responseMessage ?? null };
  });
}
