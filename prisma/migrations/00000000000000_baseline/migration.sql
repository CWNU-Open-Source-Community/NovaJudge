-- Existing installations record this baseline without executing its CREATE statements.
BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ContestStatus" AS ENUM ('PENDING', 'RUNNING', 'ENDED');

-- CreateEnum
CREATE TYPE "ContestType" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "ContestRole" AS ENUM ('TEAM', 'JUDGE', 'BALLOON', 'PRINT', 'OBSERVER', 'ADMIN');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('PENDING', 'JUDGING', 'ACCEPTED', 'WRONG_ANSWER', 'TIME_LIMIT_EXCEEDED', 'MEMORY_LIMIT_EXCEEDED', 'RUNTIME_ERROR', 'COMPILE_ERROR', 'PRESENTATION_ERROR', 'SYSTEM_ERROR');

-- CreateEnum
CREATE TYPE "ClariCategory" AS ENUM ('QUESTION', 'NOTICE');

-- CreateEnum
CREATE TYPE "PrintJobStatus" AS ENUM ('PENDING', 'PRINTING', 'PRINTED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "global_users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT,
    "role" TEXT NOT NULL DEFAULT 'GLOBAL_USER',
    "displayName" TEXT,
    "studentId" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "global_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT,
    "userId" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "plainPassword" TEXT,
    "contestId" INTEGER NOT NULL,
    "displayName" TEXT,
    "members" TEXT,
    "school" TEXT,
    "seat" TEXT,
    "coach" TEXT,
    "category" TEXT,
    "role" "ContestRole" NOT NULL DEFAULT 'TEAM',
    "autoLoginIp" TEXT,
    "lastLoginIp" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "proctoringKeyHash" VARCHAR(64),
    "proctoringLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contests" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "type" "ContestType" NOT NULL DEFAULT 'PUBLIC',
    "password" TEXT,
    "status" "ContestStatus" NOT NULL DEFAULT 'PENDING',
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cli_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "activeContestId" INTEGER,

    CONSTRAINT "cli_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cli_devices" (
    "id" TEXT NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "userCode" VARCHAR(9) NOT NULL,
    "contestId" INTEGER NOT NULL,
    "userId" TEXT,
    "contestAccessToken" TEXT,
    "proctoringKeyHash" VARCHAR(64),
    "pairingExpiresAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cli_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balloons" (
    "id" SERIAL NOT NULL,
    "submissionId" TEXT NOT NULL,
    "contestId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "assignedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "balloons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "print_jobs" (
    "id" SERIAL NOT NULL,
    "contestId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sourceFilename" TEXT,
    "status" "PrintJobStatus" NOT NULL DEFAULT 'PENDING',
    "printerName" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "printedAt" TIMESTAMP(3),

    CONSTRAINT "print_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "problems" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'default',
    "defaultTimeLimit" INTEGER NOT NULL,
    "defaultMemoryLimit" INTEGER NOT NULL,
    "sections" JSONB NOT NULL,
    "samples" JSONB NOT NULL,
    "hint" TEXT,
    "judgeConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "problems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_problems" (
    "id" TEXT NOT NULL,
    "contestId" INTEGER NOT NULL,
    "problemId" INTEGER NOT NULL,
    "displayId" TEXT NOT NULL,
    "realTimeLimit" INTEGER,
    "realMemoryLimit" INTEGER,
    "color" TEXT,

    CONSTRAINT "contest_problems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" TEXT NOT NULL,
    "displayId" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT,
    "globalUserId" TEXT,
    "virtualParticipationId" TEXT,
    "contestId" INTEGER,
    "problemId" INTEGER NOT NULL,
    "language" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "codeLength" INTEGER NOT NULL,
    "verdict" "Verdict" NOT NULL DEFAULT 'PENDING',
    "timeUsed" INTEGER,
    "memoryUsed" INTEGER,
    "errorMessage" TEXT,
    "passedTests" INTEGER NOT NULL DEFAULT 0,
    "totalTests" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "virtual_participations" (
    "id" TEXT NOT NULL,
    "contestId" INTEGER NOT NULL,
    "globalUserId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "virtual_participations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clarifications" (
    "id" SERIAL NOT NULL,
    "contestId" INTEGER NOT NULL,
    "displayId" TEXT,
    "problemId" INTEGER,
    "userId" TEXT,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "category" "ClariCategory" NOT NULL DEFAULT 'QUESTION',
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clarifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replies" (
    "id" SERIAL NOT NULL,
    "clarificationId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_nodes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "type" TEXT NOT NULL,
    "parentId" TEXT,
    "contestId" INTEGER,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "global_users_username_key" ON "global_users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_key" ON "api_keys"("key");

-- CreateIndex
CREATE UNIQUE INDEX "users_contestId_username_key" ON "users"("contestId", "username");

-- CreateIndex
CREATE UNIQUE INDEX "users_contestId_autoLoginIp_key" ON "users"("contestId", "autoLoginIp");

-- CreateIndex
CREATE UNIQUE INDEX "cli_devices_tokenHash_key" ON "cli_devices"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "cli_devices_userCode_key" ON "cli_devices"("userCode");

-- CreateIndex
CREATE INDEX "cli_devices_contestId_idx" ON "cli_devices"("contestId");

-- CreateIndex
CREATE INDEX "cli_devices_userId_idx" ON "cli_devices"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "balloons_submissionId_key" ON "balloons"("submissionId");

-- CreateIndex
CREATE INDEX "print_jobs_contestId_status_idx" ON "print_jobs"("contestId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contest_problems_contestId_displayId_key" ON "contest_problems"("contestId", "displayId");

-- CreateIndex
CREATE UNIQUE INDEX "contest_problems_contestId_problemId_key" ON "contest_problems"("contestId", "problemId");

-- CreateIndex
CREATE INDEX "submissions_contestId_userId_idx" ON "submissions"("contestId", "userId");

-- CreateIndex
CREATE INDEX "submissions_contestId_globalUserId_idx" ON "submissions"("contestId", "globalUserId");

-- CreateIndex
CREATE INDEX "submissions_contestId_problemId_idx" ON "submissions"("contestId", "problemId");

-- CreateIndex
CREATE INDEX "submissions_virtualParticipationId_idx" ON "submissions"("virtualParticipationId");

-- CreateIndex
CREATE INDEX "virtual_participations_contestId_globalUserId_startedAt_idx" ON "virtual_participations"("contestId", "globalUserId", "startedAt");

-- CreateIndex
CREATE INDEX "virtual_participations_contestId_idx" ON "virtual_participations"("contestId");

-- CreateIndex
CREATE INDEX "virtual_participations_globalUserId_idx" ON "virtual_participations"("globalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_participations_contestId_globalUserId_attemptNo_key" ON "virtual_participations"("contestId", "globalUserId", "attemptNo");

-- CreateIndex
CREATE INDEX "clarifications_contestId_category_idx" ON "clarifications"("contestId", "category");

-- CreateIndex
CREATE INDEX "replies_clarificationId_createdAt_id_idx" ON "replies"("clarificationId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "global_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cli_settings" ADD CONSTRAINT "cli_settings_activeContestId_fkey" FOREIGN KEY ("activeContestId") REFERENCES "contests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cli_devices" ADD CONSTRAINT "cli_devices_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cli_devices" ADD CONSTRAINT "cli_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balloons" ADD CONSTRAINT "balloons_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balloons" ADD CONSTRAINT "balloons_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balloons" ADD CONSTRAINT "balloons_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_problems" ADD CONSTRAINT "contest_problems_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_problems" ADD CONSTRAINT "contest_problems_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "problems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_globalUserId_fkey" FOREIGN KEY ("globalUserId") REFERENCES "global_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_virtualParticipationId_fkey" FOREIGN KEY ("virtualParticipationId") REFERENCES "virtual_participations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "problems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "virtual_participations" ADD CONSTRAINT "virtual_participations_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "virtual_participations" ADD CONSTRAINT "virtual_participations_globalUserId_fkey" FOREIGN KEY ("globalUserId") REFERENCES "global_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clarifications" ADD CONSTRAINT "clarifications_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clarifications" ADD CONSTRAINT "clarifications_problemId_fkey" FOREIGN KEY ("problemId") REFERENCES "problems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clarifications" ADD CONSTRAINT "clarifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replies" ADD CONSTRAINT "replies_clarificationId_fkey" FOREIGN KEY ("clarificationId") REFERENCES "clarifications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replies" ADD CONSTRAINT "replies_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_nodes" ADD CONSTRAINT "training_nodes_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "training_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_nodes" ADD CONSTRAINT "training_nodes_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
