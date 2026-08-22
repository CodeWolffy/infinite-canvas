import type { FastifyInstance } from "fastify";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { authenticate } from "../auth/session.js";
import { db } from "../db/client.js";
import { models, userPreferences } from "../db/schema.js";

const preferencesBody = z.record(z.string(), z.unknown());

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
