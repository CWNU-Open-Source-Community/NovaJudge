CREATE TABLE "cli_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "activeContestId" INTEGER,
    CONSTRAINT "cli_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cli_settings_singleton" CHECK ("id" = 1)
);

CREATE TABLE "cli_devices" (
    "id" TEXT NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "userCode" VARCHAR(9) NOT NULL,
    "contestId" INTEGER NOT NULL,
    "userId" TEXT,
    "contestAccessToken" TEXT,
    "pairingExpiresAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cli_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cli_devices_tokenHash_key" ON "cli_devices"("tokenHash");
CREATE UNIQUE INDEX "cli_devices_userCode_key" ON "cli_devices"("userCode");
CREATE INDEX "cli_devices_contestId_idx" ON "cli_devices"("contestId");
CREATE INDEX "cli_devices_userId_idx" ON "cli_devices"("userId");
ALTER TABLE "cli_settings" ADD CONSTRAINT "cli_settings_activeContestId_fkey" FOREIGN KEY ("activeContestId") REFERENCES "contests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cli_devices" ADD CONSTRAINT "cli_devices_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cli_devices" ADD CONSTRAINT "cli_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
