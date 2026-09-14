ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "capability" "model_capability" DEFAULT 'image' NOT NULL;
