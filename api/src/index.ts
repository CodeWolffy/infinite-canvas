import { buildApp } from "./app.js";
import { bootstrapAdmin, recoverInterruptedTextRequests } from "./bootstrap.js";
import { config } from "./config.js";
import { closeDatabase, migrateDatabase } from "./db/client.js";
import { ensureMediaBucket } from "./media.js";
import { startOrphanCleanup, stopOrphanCleanup } from "./media-cleanup.js";
import { startGenerationWorker, stopGenerationWorker } from "./generation-worker.js";

await migrateDatabase();
await ensureMediaBucket();
await recoverInterruptedTextRequests();
await bootstrapAdmin();
await startGenerationWorker();
const orphanTimer = startOrphanCleanup((error, mediaId) => console.error("[media-cleanup]", mediaId, error));

const app = buildApp();
const close = async () => {
  stopOrphanCleanup(orphanTimer);
  await app.close();
  await stopGenerationWorker();
  await closeDatabase();
  process.exit(0);
};
process.on("SIGINT", close);
process.on("SIGTERM", close);

await app.listen({ host: config.HOST, port: config.PORT });
