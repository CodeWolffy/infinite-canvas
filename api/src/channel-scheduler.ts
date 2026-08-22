import { and, desc, eq, isNull, lte, or } from "drizzle-orm";
import { decryptSecret } from "./crypto.js";
import { db, sqlClient } from "./db/client.js";
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
    const candidate: ChannelCandidate = {
      ...row,
      apiKey: row.encryptedApiKey ? decryptSecret(row.encryptedApiKey) : undefined,
    };
    const group = groups.get(row.priority) ?? [];
    group.push(candidate);
    groups.set(row.priority, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b - a)
    .flatMap(([, candidates]) => weightedShuffle(candidates));
}

export async function withChannelSlot<T>(candidate: ChannelCandidate, action: () => Promise<T>) {
  const reserved = await sqlClient.reserve();
  let slot: number | undefined;
  try {
    const deadline = Date.now() + Math.max(Math.floor(candidate.timeoutMs / 2), 1000);
    let delay = 250;
    while (slot === undefined && Date.now() < deadline) {
      const [result] = await reserved<{ slot: number }[]>`
        select slot
        from generate_series(0, ${candidate.maxConcurrency - 1}::int) as slots(slot)
        where pg_try_advisory_lock(hashtext(${candidate.channelId})::int, slot)
        limit 1
      `;
      slot = result?.slot;
      if (slot === undefined) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 1000);
      }
    }
    if (slot === undefined) throw new UpstreamError("渠道并发槽位等待超时", "channel_busy", undefined, "always");
    return await action();
  } finally {
    if (slot !== undefined) {
      await reserved`select pg_advisory_unlock(hashtext(${candidate.channelId})::int, ${slot}::int)`;
    }
    reserved.release();
  }
}

export async function markChannelResult(candidate: ChannelCandidate, error?: UpstreamError) {
  const now = new Date();
  await db
    .update(channels)
    .set(
      error
        ? {
            lastFailureAt: now,
            lastErrorCode: error.category,
            ...(error.httpStatus === 401 || error.httpStatus === 403
              ? { status: "needs_attention" as const, cooldownUntil: new Date(now.getTime() + 5 * 60 * 1000) }
              : {}),
            updatedAt: now,
          }
        : { lastSuccessAt: now, lastErrorCode: null, updatedAt: now },
    )
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
