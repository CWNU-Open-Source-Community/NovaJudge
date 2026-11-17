BEGIN;

-- Additive upgrade for the public schema; idempotent for existing private sites.
CREATE TABLE IF NOT EXISTS "system_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "allowExternalLogin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- Change the default for new settings only. Do not update existing preferences.
ALTER TABLE "system_settings" ALTER COLUMN "allowExternalLogin" SET DEFAULT false;
ALTER TABLE "global_users" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "global_users" ADD COLUMN IF NOT EXISTS "isBanned" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS "global_users_externalId_key" ON "global_users"("externalId");
CREATE INDEX IF NOT EXISTS "submissions_submittedAt_idx" ON "submissions"("submittedAt");

COMMIT;
