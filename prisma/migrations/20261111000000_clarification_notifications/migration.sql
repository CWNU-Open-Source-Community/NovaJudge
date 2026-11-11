CREATE INDEX IF NOT EXISTS "clarifications_contestId_category_idx"
  ON "clarifications" ("contestId", "category");

CREATE INDEX IF NOT EXISTS "replies_clarificationId_createdAt_id_idx"
  ON "replies" ("clarificationId", "createdAt", "id");
