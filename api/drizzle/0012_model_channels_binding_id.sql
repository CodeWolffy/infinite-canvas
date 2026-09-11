ALTER TABLE "model_channels" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid();
--> statement-breakpoint
UPDATE "model_channels" SET "id" = gen_random_uuid() WHERE "id" IS NULL;
--> statement-breakpoint
ALTER TABLE "model_channels" ALTER COLUMN "id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "model_channels" DROP CONSTRAINT IF EXISTS "model_channels_pkey";
--> statement-breakpoint
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'model_channels_pkey'
  ) THEN
    ALTER TABLE "model_channels" ADD PRIMARY KEY ("id");
  END IF;
END $do$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "model_channels_model_channel_upstream_unique" ON "model_channels" ("model_id", "channel_id", "upstream_model");
