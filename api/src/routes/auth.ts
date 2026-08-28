import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "../auth/password.js";
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

class SimpleRateLimiter {
  private records = new Map<string, { count: number; resetAt: number }>();

  check(key: string, maxAttempts: number, windowMs: number): { allowed: boolean; retryAfterSeconds: number } {
    const now = Date.now();
    const current = this.records.get(key);
    if (!current || now >= current.resetAt) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (current.count >= maxAttempts) {
      const retryAfterSeconds = Math.ceil((current.resetAt - now) / 1000);
      return { allowed: false, retryAfterSeconds };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  recordFailure(key: string, windowMs: number) {
    const now = Date.now();
    const current = this.records.get(key);
    if (!current || now >= current.resetAt) {
      this.records.set(key, { count: 1, resetAt: now + windowMs });
    } else {
      current.count += 1;
    }
  }

  reset(key: string) {
    this.records.delete(key);
  }
}

const authRateLimiter = new SimpleRateLimiter();

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
    const clientIp = request.ip || "unknown";
    const rateLimitKey = `login:${clientIp}:${username}`;

    const limitStatus = authRateLimiter.check(rateLimitKey, 5, 60 * 1000);
    if (!limitStatus.allowed) {
      return reply
        .code(429)
        .header("Retry-After", String(limitStatus.retryAfterSeconds))
        .send({ error: "too_many_requests", message: `尝试次数过多，请在 ${limitStatus.retryAfterSeconds} 秒后再试` });
    }

    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.username, username), eq(users.status, "active")))
      .limit(1);

    const hashToVerify = user ? user.passwordHash : DUMMY_PASSWORD_HASH;
    const isValid = await verifyPassword(hashToVerify, body.password);

    if (!user || !isValid) {
      authRateLimiter.recordFailure(rateLimitKey, 60 * 1000);
      return reply.code(401).send({ error: "invalid_credentials", message: "用户名或密码错误" });
    }

    authRateLimiter.reset(rateLimitKey);
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

    const rateLimitKey = `change-password:${user.id}`;
    const limitStatus = authRateLimiter.check(rateLimitKey, 5, 60 * 1000);
    if (!limitStatus.allowed) {
      return reply
        .code(429)
        .header("Retry-After", String(limitStatus.retryAfterSeconds))
        .send({ error: "too_many_requests", message: `修改密码尝试过于频繁，请在 ${limitStatus.retryAfterSeconds} 秒后再试` });
    }

    const body = changePasswordBody.parse(request.body);
    if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
      authRateLimiter.recordFailure(rateLimitKey, 60 * 1000);
      return reply.code(400).send({ error: "invalid_password", message: "当前密码错误" });
    }
    if (body.currentPassword === body.newPassword) {
      return reply.code(400).send({ error: "password_unchanged", message: "新密码不能与当前密码相同" });
    }

    authRateLimiter.reset(rateLimitKey);

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
