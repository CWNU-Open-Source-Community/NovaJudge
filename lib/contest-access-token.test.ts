import assert from "node:assert/strict";
import test from "node:test";
import { decodeJwt, SignJWT } from "jose";
import {
  contestAccessCookieName,
  matchesContestPassword,
  signContestAccessToken,
  verifyContestAccessToken,
} from "./contest-access-token";

const secret = new TextEncoder().encode("private-contest-regression-test-secret");
const contest = { id: 1001, password: "比赛 secret:123" };

test("password matching is exact and an unconfigured private contest fails closed", () => {
  assert.equal(matchesContestPassword(contest.password, contest.password), true);
  for (const candidate of ["", "wrong", "比赛 Secret:123", `${contest.password} `]) {
    assert.equal(matchesContestPassword(candidate, contest.password), false);
  }
  assert.equal(matchesContestPassword("", ""), false);
  assert.equal(matchesContestPassword("anything", null), false);
});

test("a password grant works only for its contest, including contests sharing a password", async () => {
  const token = await signContestAccessToken(contest, secret);
  assert.equal(await verifyContestAccessToken(token, contest, secret), true);
  assert.equal(await verifyContestAccessToken(token, { ...contest, id: 1002 }, secret), false);
  assert.notEqual(contestAccessCookieName(1001), contestAccessCookieName(1002));
  assert.equal(decodeJwt(token).password, undefined);
  assert.ok(!JSON.stringify(decodeJwt(token)).includes(contest.password));
});

test("changing or removing the password immediately revokes an existing grant", async () => {
  const token = await signContestAccessToken(contest, secret);
  for (const password of ["new password", "", null]) {
    assert.equal(await verifyContestAccessToken(token, { ...contest, password }, secret), false);
  }
  await assert.rejects(signContestAccessToken({ ...contest, password: null }, secret));
});

test("rejects forged, malformed and wrong-key grants", async () => {
  const token = await signContestAccessToken(contest, secret);
  const [header, payload, signature] = token.split(".");
  const forgedPayload = Buffer.from(JSON.stringify({ ...decodeJwt(token), sub: "1002" })).toString("base64url");
  for (const badToken of ["", "garbage", `${header}.${forgedPayload}.${signature}`, `${header}.${payload}.invalid`]) {
    assert.equal(await verifyContestAccessToken(badToken, contest, secret), false);
  }
  assert.equal(await verifyContestAccessToken(token, contest, new TextEncoder().encode("different-secret")), false);
});

test("expired grants and ordinary account JWTs cannot unlock a private contest", async () => {
  const valid = decodeJwt(await signContestAccessToken(contest, secret));
  const expired = await new SignJWT({ ...valid, exp: 1 })
    .setProtectedHeader({ alg: "HS256" }).sign(secret);
  const account = await new SignJWT({ userId: "team", contestId: 1001, role: "TEAM" })
    .setProtectedHeader({ alg: "HS256" }).setExpirationTime("24h").sign(secret);
  const missingExpiry = { ...valid };
  delete missingExpiry.exp;
  const noExpiry = await new SignJWT(missingExpiry).setProtectedHeader({ alg: "HS256" }).sign(secret);
  for (const token of [expired, account, noExpiry]) {
    assert.equal(await verifyContestAccessToken(token, contest, secret), false);
  }
});
