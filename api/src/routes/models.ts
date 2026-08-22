import type { FastifyInstance } from "fastify";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { authenticate } from "../auth/session.js";
import { db } from "../db/client.js";
import { appSettings, models, userPreferences } from "../db/schema.js";

const preferencesBody = z.record(z.string(), z.unknown());
const announcementBody = z.object({ content: z.string().trim().max(500).default("") });
const announcementKey = "announcement";

async function readAnnouncement() {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, announcementKey))
    .limit(1);
  const content = (row?.value as { content?: unknown } | undefined)?.content;
  return typeof content === "string" ? content : "";
}

export async function modelRoutes(app: FastifyInstance) {
  app.get("/", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    const result = await db
      .select({
        id: models.id,
        name: models.name,
        displayName: models.displayName,
        capability: models.capability,
        description: models.description,
      })
      .from(models)
      .where(and(eq(models.status, "published"), isNull(models.deletedAt)))
      .orderBy(asc(models.displayName));
    return { models: result };
  });
}

export async function preferenceRoutes(app: FastifyInstance) {
  app.get("/announcement", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    return { content: await readAnnouncement() };
  });

  app.put("/admin/announcement", async (request, reply) => {
    const admin = await authenticate(request, reply, { admin: true });
    if (!admin) return;
    const body = announcementBody.parse(request.body);
    await db
      .insert(appSettings)
      .values({ key: announcementKey, value: { content: body.content } })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: { content: body.content }, updatedAt: new Date() },
      });
    return { content: body.content };
  });

  app.get("/preferences", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    const [result] = await db
      .select({ preferences: userPreferences.preferences })
      .from(userPreferences)
      .where(eq(userPreferences.userId, user.id))
      .limit(1);
    return { preferences: result?.preferences ?? {} };
  });

  app.put("/preferences", async (request, reply) => {
    const user = await authenticate(request, reply);
    if (!user) return;
    const preferences = preferencesBody.parse(request.body);
    await db
      .insert(userPreferences)
      .values({ userId: user.id, preferences })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: { preferences, updatedAt: new Date() },
      });
    return { preferences };
  });
}
