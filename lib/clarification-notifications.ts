import { Prisma } from "@/lib/generated/prisma/client";

export interface ClarificationNotification {
  id: number;
  contestId: number;
  contestTitle: string;
  title: string | null;
  displayId: string | null;
  authorName: string;
  activityAt: string;
  eventKey: string;
}

export interface ClarificationNotificationFeed {
  viewerKey: string;
  total: number;
  questions: ClarificationNotification[];
}

type PendingQuestionRow = Omit<ClarificationNotification, "activityAt" | "eventKey"> & {
  activityAt: Date;
  replyId: number | null;
  total: number;
};

export async function getPendingClarifications(
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  contestId: number,
): Promise<Omit<ClarificationNotificationFeed, "viewerKey">> {
  // A thread needs attention when its latest message is from a contestant.
  // Looking only for zero replies would miss follow-up questions.
  const rows = await db.$queryRaw<PendingQuestionRow[]>(Prisma.sql`
    SELECT c.id, c."contestId", contest.title AS "contestTitle",
      c.title, c."displayId",
      COALESCE(latest."authorName", author."displayName", author.username, '') AS "authorName",
      COALESCE(latest."createdAt", c."createdAt") AS "activityAt",
      latest.id AS "replyId",
      (COUNT(*) OVER ())::int AS total
    FROM clarifications c
    JOIN contests contest ON contest.id = c."contestId"
    LEFT JOIN users author ON author.id = c."userId"
    LEFT JOIN LATERAL (
      SELECT r.id, r."createdAt", u.role,
        COALESCE(u."displayName", u.username) AS "authorName"
      FROM replies r
      JOIN users u ON u.id = r."userId"
      WHERE r."clarificationId" = c.id
      ORDER BY r."createdAt" DESC, r.id DESC
      LIMIT 1
    ) latest ON true
    WHERE c.category = 'QUESTION'
      AND COALESCE(latest.role, author.role)::text NOT IN ('ADMIN', 'JUDGE')
      AND c."contestId" = ${contestId}
    ORDER BY "activityAt" DESC, c.id DESC
    LIMIT 50
  `);

  return {
    total: rows[0]?.total ?? 0,
    questions: rows.map((question) => ({
      id: question.id,
      contestId: question.contestId,
      contestTitle: question.contestTitle,
      title: question.title,
      displayId: question.displayId,
      authorName: question.authorName,
      activityAt: question.activityAt.toISOString(),
      eventKey: `${question.id}:${question.replyId ?? 0}`,
    })),
  };
}
