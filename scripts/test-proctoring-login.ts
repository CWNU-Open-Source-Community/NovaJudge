// Creates and removes its own users/contest in the local deployment only.
import "dotenv/config";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { proctoringKeyHash } from "../lib/proctoring-access";
import { signAuth } from "../lib/auth";

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
const page = (token: string, key?: string, grant?: string) => fetch(base + "/contest/" + contest.id, { headers: { Cookie: "user_token=" + token + (grant ? `; contest_access_${contest.id}=${grant}` : ""), ...(key ? { "x-novajudge-proctor-key": key } : {}) }, redirect: "manual" });
let externalUserId: string | undefined;
let ordinaryUserId: string | undefined;
try {
  const normal = await login(); assert.equal(normal.status, 200); const old = await normal.json();
  assert.equal((await page(old.token)).status, 200);
  const forged = await login({ loginSource: "PROCTORING" }); assert.equal(forged.status, 403);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).proctoringKeyHash, null);
  const monitored = await login({ loginSource: "PROCTORING" }, { "x-api-key": access.apiKey });
  assert.equal(monitored.status, 200, await monitored.clone().text());
  assert.equal(monitored.headers.get("cache-control"), "private, no-store");
  const proof = await monitored.json(); assert.equal(proof.loginSource, "PROCTORING"); assert.equal(proof.proctoringKey.length, 43);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).proctoringKeyHash, proctoringKeyHash(proof.proctoringKey));
  assert.equal((await login()).status, 403, "ordinary CLI/browser credentials cannot replace the monitor binding");
  const browserLogin = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password, contestId: contest.id }) });
  assert.equal(browserLogin.status, 403, "the browser login API must reject proctored accounts");
  assert.equal(browserLogin.headers.has("set-cookie"), false);
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

  const external = await prisma.globalUser.create({ data: { username: username + "-external", externalId: username + "-external", role: "GLOBAL_USER" } });
  externalUserId = external.id;
  const externalToken = await signAuth({ userId: external.id, username: external.username, role: external.role, contestId: null, isGlobalAdmin: false });
  const globalCookies = `auth_token=${externalToken}; user_token=${old.token}`;
  const identity = await fetch(base + "/api/auth/me", { headers: { Cookie: globalCookies } });
  assert.equal(identity.status, 200, "a valid external session takes precedence over a stale proctored cookie");
  assert.equal((await identity.json()).user.username, external.username);
  assert.equal((await fetch(base + "/contest/" + contest.id, { headers: { Cookie: globalCookies }, redirect: "manual" })).status, 200);
  await prisma.globalUser.update({ where: { id: external.id }, data: { isBanned: true } });
  assert.equal((await fetch(base + "/api/auth/me", { headers: { Cookie: globalCookies } })).status, 403, "banned global sessions cannot bypass the proctor guard");
  await prisma.globalUser.update({ where: { id: external.id }, data: { isBanned: false } });

  const ordinary = await prisma.user.create({ data: { contestId: contest.id, username: username + "-ordinary", password: await bcrypt.hash(password, 10) } });
  ordinaryUserId = ordinary.id;
  const ordinaryToken = await signAuth({ userId: ordinary.id, username: ordinary.username, role: ordinary.role, contestId: contest.id, isGlobalAdmin: false });
  const context = (authorization: string, cookie?: string, key?: string) => fetch(base + "/api/cli/context", {
    method: "POST",
    headers: { "content-type": "application/json", authorization, ...(cookie ? { Cookie: cookie } : {}), ...(key ? { "x-novajudge-proctor-key": key } : {}) },
    body: JSON.stringify({ contestId: contest.id }),
  });
  for (const cookie of [`user_token=${ordinaryToken}`, `auth_token=${externalToken}`]) {
    assert.equal((await context(`Bearer ${replacement.token}`, cookie)).status, 403, "CLI authentication cannot be bypassed with another browser identity");
  }
  assert.equal((await context(`Bearer  ${replacement.token}`)).status, 403, "CLI whitespace must not bypass the guard");
  assert.equal((await context(`Bearer ${replacement.token}`, undefined, replacement.proctoringKey)).status, 400, "valid proctoring proof reaches CLI input validation");
  const contestPassword = randomBytes(18).toString("base64url");
  await prisma.contest.update({ where: { id: contest.id }, data: { type: "PRIVATE", password: contestPassword } });
  const missingContestPassword = await login({ loginSource: "PROCTORING" }, { "x-api-key": access.apiKey });
  assert.equal(missingContestPassword.status, 403);
  assert.equal((await missingContestPassword.json()).code, "CONTEST_PASSWORD_REQUIRED");
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).proctoringKeyHash, proctoringKeyHash(replacement.proctoringKey), "failed private login must not replace the proctor binding");
  const privateLogin = await login({ loginSource: "PROCTORING", contestPassword }, { "x-api-key": access.apiKey });
  assert.equal(privateLogin.status, 200);
  const privateProof = await privateLogin.json();
  assert.equal(typeof privateProof.contestAccessToken, "string");
  const withoutGrant = await page(privateProof.token, privateProof.proctoringKey);
  assert([302, 307].includes(withoutGrant.status));
  assert(withoutGrant.headers.get("location")?.endsWith(`/contest/${contest.id}/access`));
  assert.equal((await page(privateProof.token, privateProof.proctoringKey, privateProof.contestAccessToken)).status, 200);
  assert.equal((await page(privateProof.token, undefined, privateProof.contestAccessToken)).status, 403, "private grant cannot replace proctoring proof");
  const privateContext = (grant?: string) => fetch(base + "/api/cli/context", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${privateProof.token}`, "x-novajudge-proctor-key": privateProof.proctoringKey, ...(grant ? { "x-contest-access-token": grant } : {}) },
    body: JSON.stringify({ contestId: contest.id, problem: "A" }),
  });
  const missingGrant = await privateContext();
  assert.equal(missingGrant.status, 403);
  assert.equal((await missingGrant.json()).code, "CONTEST_PASSWORD_REQUIRED");
  assert.equal((await privateContext(privateProof.contestAccessToken)).status, 404, "valid credentials reach the intentionally empty problem set");
  await prisma.contest.update({ where: { id: contest.id }, data: { password: randomBytes(18).toString("base64url") } });
  assert.equal((await privateContext(privateProof.contestAccessToken)).status, 403, "password rotation revokes the private grant");
  console.log("Proctoring HTTP integration passed: binding/relogin, copied-cookie/IP rejection, external-session priority, banned-user enforcement, CLI identity isolation, private password/grant checks and rotation.");
} finally {
  if (ordinaryUserId) await prisma.user.delete({ where: { id: ordinaryUserId } });
  if (externalUserId) await prisma.globalUser.delete({ where: { id: externalUserId } });
  await prisma.user.delete({ where: { id: user.id } }); await prisma.contest.delete({ where: { id: contest.id } }); await prisma.$disconnect();
}

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
