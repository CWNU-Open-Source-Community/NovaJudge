DROP TABLE IF EXISTS "system_settings";

DROP INDEX IF EXISTS "global_users_externalId_key";

ALTER TABLE "global_users"
  DROP COLUMN IF EXISTS "externalId",
  DROP COLUMN IF EXISTS "isBanned";
