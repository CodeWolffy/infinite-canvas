import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
import { decryptSecret } from "./crypto.js";
import { db } from "./db/client.js";
import { channels, modelChannels } from "./db/schema.js";

export type ChannelCandidate = {
  channelId: string;
  channelName: string;
  protocol: "openai" | "gemini";
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  maxConcurrency: number;
  upstreamModel: string;
  priority: number;
  weight: number;
};

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly category: string,
    readonly httpStatus?: number,
    readonly failover: "always" | "once" | "never" = "never",
  ) {
    super(message);
  }
}

export async function hasChannelCandidates(modelId: string) {
  const [row] = await db
    .select({ id: channels.id })
    .from(modelChannels)
    .innerJoin(channels, eq(channels.id, modelChannels.channelId))
    .where(
      and(
        eq(modelChannels.modelId, modelId),
        eq(modelChannels.enabled, true),
        eq(channels.status, "active"),
        or(isNull(channels.cooldownUntil), lte(channels.cooldownUntil, new Date())),
      ),
    )
    .limit(1);
  return Boolean(row);
}

function weightedShuffle(candidates: ChannelCandidate[]) {
  return candidates
    .map((candidate) => ({ candidate, key: -Math.log(Math.random() || Number.EPSILON) / candidate.weight }))
    .sort((a, b) => a.key - b.key)
    .map(({ candidate }) => candidate);
}

export async function getChannelCandidates(modelId: string) {
  const rows = await db
    .select({
      channelId: channels.id,
      channelName: channels.name,
      protocol: channels.protocol,
      baseUrl: channels.baseUrl,
      encryptedApiKey: channels.encryptedApiKey,
      timeoutMs: channels.timeoutMs,
      maxConcurrency: channels.maxConcurrency,
      upstreamModel: modelChannels.upstreamModel,
      priority: modelChannels.priority,
      weight: modelChannels.weight,
    })
    .from(modelChannels)
    .innerJoin(channels, eq(channels.id, modelChannels.channelId))
    .where(
      and(
        eq(modelChannels.modelId, modelId),
        eq(modelChannels.enabled, true),
        eq(channels.status, "active"),
        or(isNull(channels.cooldownUntil), lte(channels.cooldownUntil, new Date())),
      ),
    )
    .orderBy(desc(modelChannels.priority));

  const groups = new Map<number, ChannelCandidate[]>();
  for (const row of rows) {
    let apiKey: string | undefined;
    if (row.encryptedApiKey) {
      try {
        apiKey = decryptSecret(row.encryptedApiKey);
      } catch (err) {
        console.warn(`[ChannelScheduler] 渠道 ${row.channelName} (${row.channelId}) 密钥解密失败，已跳过:`, err);
        continue;
      }
    }
    const candidate: ChannelCandidate = {
      ...row,
      apiKey,
    };
    const group = groups.get(row.priority) ?? [];
    group.push(candidate);
    groups.set(row.priority, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b - a)
    .flatMap(([, candidates]) => weightedShuffle(candidates));
}

class ChannelConcurrencyLimiter {
  private running = new Map<string, number>();
  private waiters = new Map<string, Array<() => void>>();

  async acquire(channelId: string, maxConcurrency: number, timeoutMs: number): Promise<() => void> {
    const current = this.running.get(channelId) ?? 0;
    if (current < Math.max(1, maxConcurrency)) {
      this.running.set(channelId, current + 1);
      return () => this.release(channelId);
    }

    return new Promise<() => void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const queue = this.waiters.get(channelId);
        if (queue) {
          const idx = queue.indexOf(onAvailable);
          if (idx !== -1) queue.splice(idx, 1);
          if (queue.length === 0) this.waiters.delete(channelId);
        }
        reject(new UpstreamError("渠道并发槽位等待超时", "channel_busy", undefined, "always"));
      }, timeoutMs);

      const onAvailable = () => {
        clearTimeout(timer);
        this.running.set(channelId, (this.running.get(channelId) ?? 0) + 1);
        resolve(() => this.release(channelId));
      };

      const queue = this.waiters.get(channelId) ?? [];
      queue.push(onAvailable);
      this.waiters.set(channelId, queue);
    });
  }

  private release(channelId: string) {
    const current = this.running.get(channelId) ?? 1;
    if (current <= 1) {
      this.running.delete(channelId);
    } else {
      this.running.set(channelId, current - 1);
    }

    const queue = this.waiters.get(channelId);
    if (queue && queue.length > 0) {
      const next = queue.shift()!;
      if (queue.length === 0) this.waiters.delete(channelId);
      next();
    }
  }
}

const limiter = new ChannelConcurrencyLimiter();

export async function withChannelSlot<T>(candidate: ChannelCandidate, action: () => Promise<T>) {
  const timeoutMs = Math.max(Math.floor(candidate.timeoutMs / 2), 1000);
  const release = await limiter.acquire(candidate.channelId, candidate.maxConcurrency, timeoutMs);
  try {
    return await action();
  } finally {
    release();
  }
}

export async function markChannelResult(candidate: ChannelCandidate, error?: UpstreamError) {
  const now = new Date();
  if (!error) {
    await db
      .update(channels)
      .set({ lastSuccessAt: now, lastErrorCode: null, cooldownUntil: null, updatedAt: now })
      .where(eq(channels.id, candidate.channelId));
    return;
  }

  const isAuthError = error.httpStatus === 401 || error.httpStatus === 403;
  const isChannelFault =
    error.category === "timeout" ||
    error.category === "network" ||
    error.category === "channel_busy" ||
    error.httpStatus === 429 ||
    (typeof error.httpStatus === "number" && error.httpStatus >= 500);

  const cooldownMs = isAuthError ? 5 * 60 * 1000 : isChannelFault ? 2 * 60 * 1000 : 0;

  await db
    .update(channels)
    .set({
      lastFailureAt: now,
      lastErrorCode: error.category,
      ...(isAuthError ? { status: "needs_attention" as const } : {}),
      ...(cooldownMs > 0 ? { cooldownUntil: new Date(now.getTime() + cooldownMs) } : {}),
      updatedAt: now,
    })
    .where(eq(channels.id, candidate.channelId));
}

export async function runWithFailover<T>(
  modelId: string,
  action: (candidate: ChannelCandidate, attempt: number) => Promise<T>,
) {
  const candidates = await getChannelCandidates(modelId);
  if (!candidates.length) throw new UpstreamError("没有可用渠道", "no_channel", undefined, "never");
  let ambiguousRetryPending = false;
  let ambiguousSourceChannelId: string | undefined;
  let lastError: UpstreamError | undefined;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    try {
      const result = await withChannelSlot(candidate, () => action(candidate, index + 1));
      await markChannelResult(candidate);
      return { result, candidate };
    } catch (error) {
      const upstream =
        error instanceof UpstreamError
          ? error
          : new UpstreamError("上游请求失败", "unknown", undefined, "once");
      lastError = upstream;
      await markChannelResult(candidate, upstream);
      if (ambiguousRetryPending && candidate.channelId !== ambiguousSourceChannelId) throw upstream;
      if (upstream.failover === "never") throw upstream;
      if (upstream.failover === "once") {
        ambiguousRetryPending = true;
        ambiguousSourceChannelId = candidate.channelId;
      }
    }
  }
  throw lastError ?? new UpstreamError("没有可用渠道", "no_channel");
}
