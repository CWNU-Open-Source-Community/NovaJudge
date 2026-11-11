/** Tests the real PostgreSQL query. All fixture writes roll back together. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma";
import { getPendingClarifications } from "../lib/clarification-notifications";

async function main() {
  assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname), "Only a local test database is allowed.");
  const rollback = new Error("Roll back notification fixtures");
  let checked = false;
  try {
    await prisma.$transaction(async (db) => {
      const name = `notification-qa-${randomUUID()}`;
      const now = new Date("2026-11-11T00:00:00Z");
      const contest = await db.contest.create({ data: { title: name, startTime: now, endTime: now, visible: false } });
      const other = await db.contest.create({ data: { title: `${name}-other`, startTime: now, endTime: now, visible: false } });
      const team = await db.user.create({ data: { contestId: contest.id, username: "team", displayName: "Test Team", password: "test-only", role: "TEAM" } });
      const judge = await db.user.create({ data: { contestId: contest.id, username: "judge", password: "test-only", role: "JUDGE" } });
      const admin = await db.user.create({ data: { contestId: contest.id, username: "admin", password: "test-only", role: "ADMIN" } });
      const otherTeam = await db.user.create({ data: { contestId: other.id, username: "team", password: "test-only", role: "TEAM" } });
      const read = () => getPendingClarifications(db, contest.id);
      assert.equal((await read()).total, 0);

      const question = await db.clarification.create({ data: { contestId: contest.id, userId: team.id, title: "Private question", content: "Private body", createdAt: now } });
      const publicQuestion = await db.clarification.create({ data: { contestId: contest.id, userId: team.id, title: "Public question", content: "Public body", isPublic: true, createdAt: now } });
      await db.clarification.create({ data: { contestId: contest.id, userId: judge.id, title: "Notice", content: "Announcement", category: "NOTICE", isPublic: true } });
      await db.clarification.create({ data: { contestId: contest.id, userId: judge.id, title: "Staff question", content: "No contestant message" } });
      await db.clarification.create({ data: { contestId: other.id, userId: otherTeam.id, title: "Other contest", content: "Must stay isolated" } });

      const pending = await read();
      assert.equal(pending.total, 2);
      assert.deepEqual(new Set(pending.questions.map((q) => q.id)), new Set([question.id, publicQuestion.id]));
      assert(pending.questions.every((q) => q.contestId === contest.id && q.authorName === "Test Team"));
      assert.equal((await getPendingClarifications(db, other.id)).total, 1);

      const repliedAt = new Date(now.getTime() + 1000);
      await db.reply.create({ data: { clarificationId: question.id, userId: judge.id, content: "Judge reply", createdAt: repliedAt } });
      assert.equal((await read()).total, 1);
      await db.reply.create({ data: { clarificationId: publicQuestion.id, userId: admin.id, content: "Admin reply", createdAt: repliedAt } });
      assert.equal((await read()).total, 0);

      const followUp = await db.reply.create({ data: { clarificationId: question.id, userId: team.id, content: "Follow-up", createdAt: repliedAt } });
      const reopened = await read();
      assert.equal(reopened.total, 1);
      assert.equal(reopened.questions[0].eventKey, `${question.id}:${followUp.id}`);
      assert.equal(reopened.questions[0].activityAt, repliedAt.toISOString());
      // Equal timestamps must use reply IDs to determine the latest message.
      await db.reply.create({ data: { clarificationId: question.id, userId: admin.id, content: "Resolved again", createdAt: repliedAt } });
      assert.equal((await read()).total, 0);

      await db.clarification.createMany({ data: Array.from({ length: 55 }, (_, index) => ({
        contestId: contest.id, userId: team.id, title: `Burst ${index}`, content: "Burst", createdAt: new Date(now.getTime() + index * 1000),
      })) });
      const burst = await read();
      assert.equal(burst.total, 55, "Count must include pending questions beyond the display limit");
      assert.equal(burst.questions.length, 50);
      assert.equal(burst.questions[0].title, "Burst 54");
      assert.equal(burst.questions[49].title, "Burst 5");
      assert(!("content" in burst.questions[0]), "The feed must not return full private message bodies");
      checked = true;
      throw rollback;
    }, { timeout: 30_000 });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await prisma.$disconnect();
  }
  assert(checked);
  console.log("PASS: pending questions, contest isolation, ADMIN/JUDGE replies, follow-ups, timestamp ties, bounded feed and exact totals. All fixture writes rolled back.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
