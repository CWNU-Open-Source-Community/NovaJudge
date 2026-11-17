-- Keep the admin judge-monitor rolling-window query off a full table scan.
CREATE INDEX IF NOT EXISTS "submissions_submittedAt_idx"
ON "submissions"("submittedAt");
