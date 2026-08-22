import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, max, sql } from "drizzle-orm";
import { imageSize } from "image-size";
import PgBoss from "pg-boss";
import { runWithFailover, UpstreamError } from "./channel-scheduler.js";
import { config } from "./config.js";
import { db } from "./db/client.js";
import {
  generatedImages,
  generationAttempts,
  generationBatchMedia,
  generationTasks,
  mediaObjects,
} from "./db/schema.js";
import { minio } from "./media.js";
import { generateImage, validateGeneratedImage } from "./upstream.js";

const queueName = "generate-image";
export const boss = new PgBoss({ connectionString: config.DATABASE_URL });

async function loadReferences(batchId: string) {
  const rows = await db
    .select({ media: mediaObjects, sequence: generationBatchMedia.sequence })
    .from(generationBatchMedia)
    .innerJoin(mediaObjects, eq(mediaObjects.id, generationBatchMedia.mediaId))
    .where(eq(generationBatchMedia.batchId, batchId))
    .orderBy(asc(generationBatchMedia.sequence));
  return Promise.all(
    rows.map(async ({ media }) => {
      const stream = await minio.getObject(media.bucket, media.objectKey);
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of stream) {
        total += chunk.length;
        if (total > config.MAX_UPLOAD_BYTES) {
          throw new UpstreamError("参考图片超过上传限制", "reference_too_large", undefined, "never");
        }
        chunks.push(Buffer.from(chunk));
      }
      return { buffer: Buffer.concat(chunks), mimeType: media.mimeType, filename: media.originalName };
    }),
  );
}

async function processTask(taskId: string) {
  const [task] = await db.select().from(generationTasks).where(eq(generationTasks.id, taskId)).limit(1);
  if (!task || task.status !== "queued") return;
  const claimed = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${task.batchId}::text, 0))`);
    const [result] = await tx
      .update(generationTasks)
      .set({ status: "running", startedAt: new Date(), finishedAt: null, errorCode: null, errorMessage: null })
      .where(and(eq(generationTasks.id, taskId), eq(generationTasks.status, "queued")))
      .returning();
    return result;
  });
  if (!claimed) return;

  try {
    const references = await loadReferences(task.batchId);
    const [attemptState] = await db
      .select({ maxAttempt: max(generationAttempts.attemptNumber) })
      .from(generationAttempts)
      .where(eq(generationAttempts.taskId, task.id));
    const attemptOffset = attemptState?.maxAttempt ?? 0;
    const { result } = await runWithFailover(task.modelId, async (channel, attemptNumber) => {
      const startedAt = new Date();
      const [attempt] = await db
        .insert(generationAttempts)
        .values({
          taskId: task.id,
          channelId: channel.channelId,
          channelNameSnapshot: channel.channelName,
          upstreamModel: channel.upstreamModel,
          attemptNumber: attemptOffset + attemptNumber,
        })
        .returning();
      try {
        const image = await generateImage(
          channel,
          task.prompt,
          (task.parameters ?? {}) as Record<string, unknown>,
          references,
        );
        const detected = await validateGeneratedImage(image);
        const finishedAt = new Date();
        await db
          .update(generationAttempts)
          .set({ status: "succeeded", finishedAt, durationMs: finishedAt.getTime() - startedAt.getTime() })
          .where(eq(generationAttempts.id, attempt!.id));
        return { image, detected };
      } catch (error) {
        const upstream = error instanceof UpstreamError ? error : new UpstreamError("上游请求失败", "unknown", undefined, "once");
        const finishedAt = new Date();
        await db
          .update(generationAttempts)
          .set({
            status: "failed",
            httpStatus: upstream.httpStatus,
            errorCategory: upstream.category,
            errorMessage: upstream.message,
            finishedAt,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
          })
          .where(eq(generationAttempts.id, attempt!.id));
        throw upstream;
      }
    });
    const { image, detected } = result;
    const dimensions = imageSize(image);
    const objectKey = `generated/${task.userId}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${detected.ext}`;
    await minio.putObject(config.MINIO_BUCKET, objectKey, image, image.length, { "Content-Type": detected.mime });
    try {
      await db.transaction(async (tx) => {
        const [media] = await tx
          .insert(mediaObjects)
          .values({
            ownerId: task.userId,
            bucket: config.MINIO_BUCKET,
            objectKey,
            originalName: `${task.id}.${detected.ext}`,
            mimeType: detected.mime,
            byteSize: image.length,
            width: dimensions.width,
            height: dimensions.height,
            sha256: createHash("sha256").update(image).digest("hex"),
            referenceCount: 1,
          })
          .returning();
        await tx.insert(generatedImages).values({
          taskId: task.id,
          mediaId: media!.id,
          billedAmount: task.priceSnapshot ?? "0",
        });
        await tx
          .update(generationTasks)
          .set({ status: "succeeded", finishedAt: new Date() })
          .where(eq(generationTasks.id, task.id));
      });
    } catch (error) {
      await minio.removeObject(config.MINIO_BUCKET, objectKey);
      throw error;
    }
  } catch (error) {
    const upstream = error instanceof UpstreamError ? error : new UpstreamError("图片任务失败", "internal_error");
    await db
      .update(generationTasks)
      .set({ status: "failed", errorCode: upstream.category, errorMessage: upstream.message, finishedAt: new Date() })
      .where(eq(generationTasks.id, task.id));
  }
}

export async function enqueueGenerationTask(taskId: string) {
  await boss.send(queueName, { taskId }, { retryLimit: 0, singletonKey: taskId });
}

export async function startGenerationWorker() {
  await boss.start();
  const existingQueue = await boss.getQueue(queueName);
  if (existingQueue && existingQueue.policy !== "short") {
    await boss.deleteQueue(queueName);
  }
  await boss.createQueue(queueName, { policy: "short" });
  const recovered = await db
    .update(generationTasks)
    .set({ status: "queued", startedAt: null, errorCode: null, errorMessage: null })
    .where(eq(generationTasks.status, "running"))
    .returning({ id: generationTasks.id });
  if (recovered.length) {
    await db
      .update(generationAttempts)
      .set({
        status: "failed",
        errorCategory: "worker_restart",
        errorMessage: "服务重启，中断的任务已重新排队",
        finishedAt: new Date(),
      })
      .where(
        and(
          inArray(generationAttempts.taskId, recovered.map((task) => task.id)),
          eq(generationAttempts.status, "running"),
        ),
      );
  }
  const queued = await db
    .select({ id: generationTasks.id })
    .from(generationTasks)
    .where(eq(generationTasks.status, "queued"));
  for (const task of queued) await enqueueGenerationTask(task.id);
  await boss.work<{ taskId: string }>(
    queueName,
    { batchSize: config.IMAGE_WORKER_CONCURRENCY },
    async (jobs) => Promise.all(jobs.map((job) => processTask(job.data.taskId))),
  );
}

export async function stopGenerationWorker() {
  await boss.stop();
}
