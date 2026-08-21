import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../auth/password.js";
import {
  authenticate,
  clearSessionCookie,
  createSession,
  publicUser,
  revokeRequestSession,
  revokeUserSessions,
} from "../auth/session.js";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";

const loginBody = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(128),
});

const changePasswordBody = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(10).max(128),
});

export async function authRoutes(app: FastifyInstance) {
  app.post("/login", async (request, reply) => {
    const body = loginBody.parse(request.body);
    const username = body.username.toLowerCase();
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.username, username), eq(users.status, "active")))
      .limit(1);

    if (!user || !(await verifyPassword(user.passwordHash, body.password))) {
      return reply.code(401).send({ error: "invalid_credentials", message: "用户名或密码错误" });
    }

    await db.update(users).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(users.id, user.id));
    await createSession(user.id, reply);
    return { user: publicUser({ ...user, lastLoginAt: new Date() }) };
  });

  app.get("/me", async (request, reply) => {
    const user = await authenticate(request, reply, { allowPasswordChange: true });
    if (!user) return;
    return { user: publicUser(user) };
  });

  app.post("/change-password", async (request, reply) => {
    const user = await authenticate(request, reply, { allowPasswordChange: true });
    if (!user) return;
    const body = changePasswordBody.parse(request.body);
    if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
      return reply.code(400).send({ error: "invalid_password", message: "当前密码错误" });
    }
    if (body.currentPassword === body.newPassword) {
      return reply.code(400).send({ error: "password_unchanged", message: "新密码不能与当前密码相同" });
    }

    await db
      .update(users)
      .set({
        passwordHash: await hashPassword(body.newPassword),
        mustChangePassword: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
    await revokeUserSessions(user.id);
    await createSession(user.id, reply);
    return { user: publicUser({ ...user, mustChangePassword: false, updatedAt: new Date() }) };
  });

  app.post("/logout", async (request, reply) => {
    await revokeRequestSession(request);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });
}
