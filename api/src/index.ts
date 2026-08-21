import { buildApp } from "./app.js";
import { bootstrapAdmin, recoverInterruptedTextRequests } from "./bootstrap.js";
import { config } from "./config.js";
import { closeDatabase, migrateDatabase } from "./db/client.js";
import { ensureMediaBucket } from "./media.js";
import { startGenerationWorker, stopGenerationWorker } from "./generation-worker.js";

await migrateDatabase();
await ensureMediaBucket();
await recoverInterruptedTextRequests();
await bootstrapAdmin();
await startGenerationWorker();

const app = buildApp();
const close = async () => {
  await app.close();
  await stopGenerationWorker();
  await closeDatabase();
  process.exit(0);
};
process.on("SIGINT", close);
process.on("SIGTERM", close);

await app.listen({ host: config.HOST, port: config.PORT });
