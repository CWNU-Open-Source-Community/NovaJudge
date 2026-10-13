// Creates and removes its own users/contest in the local deployment only.
import "dotenv/config";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { proctoringKeyHash } from "../lib/proctoring-access";

async function main() {
const database = new URL(process.env.DATABASE_URL!);
assert(["localhost", "127.0.0.1"].includes(database.hostname) && database.port === "5433", "Only the isolated local NovaJudge database is allowed");
const access = JSON.parse(await readFile(".local/access.json", "utf8"));
const base = access.url;
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const password = randomBytes(18).toString("base64url");
const contest = await prisma.contest.create({ data: { title: "监考登录隔离验收", status: "RUNNING", type: "PUBLIC", visible: false, startTime: new Date(Date.now() - 60_000), endTime: new Date(Date.now() + 3600_000) } });
const username = "proctoring-qa-" + Date.now();
const user = await prisma.user.create({ data: { contestId: contest.id, username, password: await bcrypt.hash(password, 10), autoLoginIp: "127.0.0.1" } });
const login = (extra = {}, headers = {}) => fetch(base + "/api/cli/login", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ username, password, contestId: contest.id, ...extra }) });
const page = (token: string, key?: string) => fetch(base + "/contest/" + contest.id, { headers: { Cookie: "user_token=" + token, ...(key ? { "x-novajudge-proctor-key": key } : {}) }, redirect: "manual" });
try {
  const normal = await login(); assert.equal(normal.status, 200); const old = await normal.json();
  assert.equal((await page(old.token)).status, 200);
  const forged = await login({ loginSource: "PROCTORING" }); assert.equal(forged.status, 403);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).proctoringKeyHash, null);
  const monitored = await login({ loginSource: "PROCTORING" }, { "x-api-key": access.apiKey });
  assert.equal(monitored.status, 200, await monitored.clone().text());
  assert.equal(monitored.headers.get("cache-control"), "no-store");
  const proof = await monitored.json(); assert.equal(proof.loginSource, "PROCTORING"); assert.equal(proof.proctoringKey.length, 43);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).proctoringKeyHash, proctoringKeyHash(proof.proctoringKey));
  assert.equal((await login()).status, 403, "ordinary CLI/browser credentials cannot replace the monitor binding");
  assert.equal((await page(old.token)).status, 403, "earlier ordinary browser sessions cannot access the URL");
  assert.equal((await page(proof.token)).status, 403, "copying the monitor cookie into a browser is insufficient");
  assert.equal((await page(proof.token, "PROCTORING")).status, 403);
  assert.equal((await page(proof.token, "a".repeat(43))).status, 403);
  assert.equal((await page(proof.token, proof.proctoringKey)).status, 200);
  const api = await fetch(base + "/api/auth/me", { headers: { Cookie: "user_token=" + proof.token } }); assert.equal(api.status, 403);
  const auto = await fetch(base + `/api/contests/${contest.id}/auto-login`, { headers: { "x-forwarded-for": "127.0.0.1" }, redirect: "manual" });
  assert.equal(auto.status, 302); assert(auto.headers.get("location")?.includes("proctoring_required")); assert.equal(auto.headers.has("set-cookie"), false);
  const relogin = await login({ loginSource: "PROCTORING" }, { "x-api-key": access.apiKey }); assert.equal(relogin.status, 200); const replacement = await relogin.json();
  assert.equal((await page(proof.token, proof.proctoringKey)).status, 403, "monitor relogin invalidates the previous binding");
  assert.equal((await page(replacement.token, replacement.proctoringKey)).status, 200);
  console.log("Proctoring HTTP integration passed: authorized marker, browser login block, old/copy cookie rejection, IP login block, valid client access, API guard and relogin revocation.");
} finally {
  await prisma.user.delete({ where: { id: user.id } }); await prisma.contest.delete({ where: { id: contest.id } }); await prisma.$disconnect();
}

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
