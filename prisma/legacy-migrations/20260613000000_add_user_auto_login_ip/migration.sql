-- Add explicit per-contest IP binding for TEAM auto-login.
ALTER TABLE "users" ADD COLUMN "autoLoginIp" TEXT;

CREATE UNIQUE INDEX "users_contestId_autoLoginIp_key" ON "users"("contestId", "autoLoginIp");
