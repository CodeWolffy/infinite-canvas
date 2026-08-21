import type { FastifyInstance } from "fastify";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { authenticate } from "../auth/session.js";
import { db } from "../db/client.js";
import { canvasProjects } from "../db/schema.js";
import { removeUnreferencedMedia } from "../media-cleanup.js";
import { releaseCanvasMedia, syncCanvasMedia } from "../media-references.js";

const paramsSchema = z.object({ id: z.string().uuid() });
const createBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    snapshot: z.unknown(),
  })
  .refine((body) => body.snapshot !== undefined, { path: ["snapshot"], message: "snapshot 必填" });
const updateBody = z
  .object({ title: z.string().trim().min(1).max(200).optional(), snapshot: z.unknown().optional() })
  .refine((body) => Object.keys(body).length > 0);

export async function canvasProjectRoutes(app: FastifyInstance) {
  app.get("/", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    const projects = await db
      .select()
      .from(canvasProjects)
      .where(eq(canvasProjects.userId, user.id))
      .orderBy(desc(canvasProjects.updatedAt));
    return { projects };
  });

  app.get("/:id", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    const { id } = paramsSchema.parse(request.params);
    const [project] = await db
      .select()
      .from(canvasProjects)
      .where(and(eq(canvasProjects.id, id), eq(canvasProjects.userId, user.id)))
      .limit(1);
    if (!project) return reply.code(404).send({ error: "not_found", message: "画布项目不存在" });
    return { project };
  });

  app.post("/", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    const body = createBody.parse(request.body);
    const placeholder = { nodes: [], connections: [], chatSessions: [], activeChatId: null };
    try {
      const saved = await db.transaction(async (tx) => {
        const [project] = await tx
          .insert(canvasProjects)
          .values({ userId: user.id, title: body.title, snapshot: placeholder })
          .returning();
        await syncCanvasMedia(tx, project!.id, user.id, body.snapshot);
        const [result] = await tx
          .update(canvasProjects)
          .set({ snapshot: body.snapshot, updatedAt: new Date() })
          .where(eq(canvasProjects.id, project!.id))
          .returning();
        return result;
      });
      return reply.code(201).send({ project: saved });
    } catch (error) {
      if (error instanceof Error && error.message === "CANVAS_MEDIA_FORBIDDEN") {
        return reply.code(400).send({ error: "invalid_media", message: "画布包含无权访问的文件" });
      }
      throw error;
    }
  });

  app.put("/:id", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    const { id } = paramsSchema.parse(request.params);
    const body = updateBody.parse(request.body);
    try {
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${id}::text, 0))`);
        const [existing] = await tx
          .select({ id: canvasProjects.id })
          .from(canvasProjects)
          .where(and(eq(canvasProjects.id, id), eq(canvasProjects.userId, user.id)))
          .limit(1);
        if (!existing) return undefined;
        const removedIds = body.snapshot !== undefined ? await syncCanvasMedia(tx, id, user.id, body.snapshot) : [];
        const [saved] = await tx
          .update(canvasProjects)
          .set({ ...body, updatedAt: new Date() })
          .where(eq(canvasProjects.id, id))
          .returning();
        return { project: saved, removedIds };
      });
      if (!result) return reply.code(404).send({ error: "not_found", message: "画布项目不存在" });
      await removeUnreferencedMedia(result.removedIds, (error, mediaId) => app.log.error({ err: error, mediaId }, "清理画布无引用媒体失败"));
      return { project: result.project };
    } catch (error) {
      if (error instanceof Error && error.message === "CANVAS_MEDIA_FORBIDDEN") {
        return reply.code(400).send({ error: "invalid_media", message: "画布包含无权访问的文件" });
      }
      throw error;
    }
  });

  app.delete("/:id", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    const { id } = paramsSchema.parse(request.params);
    const deletion = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${id}::text, 0))`);
      const [project] = await tx
        .select({ id: canvasProjects.id })
        .from(canvasProjects)
        .where(and(eq(canvasProjects.id, id), eq(canvasProjects.userId, user.id)))
        .limit(1);
      if (!project) return undefined;
      const removedIds = await releaseCanvasMedia(tx, id);
      await tx.delete(canvasProjects).where(eq(canvasProjects.id, id));
      return removedIds;
    });
    if (!deletion) return reply.code(404).send({ error: "not_found", message: "画布项目不存在" });
    await removeUnreferencedMedia(deletion, (error, mediaId) => app.log.error({ err: error, mediaId }, "清理画布无引用媒体失败"));
    return reply.code(204).send();
  });
}
