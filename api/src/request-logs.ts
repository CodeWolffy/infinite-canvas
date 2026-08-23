import { eq, lt, sql } from "drizzle-orm";
import { config } from "./config.js";
import { db } from "./db/client.js";
import { requestLogs } from "./db/schema.js";

type RequestLogInsert = typeof requestLogs.$inferInsert;

export async function startRequestLog(values: RequestLogInsert) {
  try {
    const [row] = await db.insert(requestLogs).values(values).returning({ id: requestLogs.id });
    return row?.id;
  } catch {
    return undefined;
  }
}

export async function finishRequestLog(
  id: string | undefined,
  error?: { httpStatus?: number; category: string; message?: string },
  billedAmount?: string | null,
) {
  if (!id) return;
  try {
    await db
      .update(requestLogs)
      .set({
        status: error ? "failed" : "succeeded",
        ...(error ? { httpStatus: error.httpStatus ?? null, errorCategory: error.category, errorMessage: error.message ?? null } : {}),
        ...(billedAmount !== undefined ? { billedAmount } : {}),
        finishedAt: new Date(),
        durationMs: sql`extract(epoch from (now() - ${requestLogs.startedAt})) * 1000`,
      })
      .where(eq(requestLogs.id, id));
  } catch {
    // 日志收口失败不影响业务请求
  }
}

export async function cleanupOldRequestLogs() {
  const cutoff = new Date(Date.now() - config.REQUEST_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await db.delete(requestLogs).where(lt(requestLogs.startedAt, cutoff)).returning({ id: requestLogs.id });
  return result.length;
}
