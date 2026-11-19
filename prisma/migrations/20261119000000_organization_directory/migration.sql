BEGIN;

CREATE TABLE IF NOT EXISTS "organization_directory" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "entries" JSONB NOT NULL,
    CONSTRAINT "organization_directory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "organization_logos" (
    "hash" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    CONSTRAINT "organization_logos_pkey" PRIMARY KEY ("hash")
);

COMMIT;
