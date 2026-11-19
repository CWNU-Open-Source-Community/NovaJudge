import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { readOrganizationLogo } from "./organization-logo";
import { indexOrganizations, matchOrganization, organizationFields } from "./organizations";
import { boardFilters, boardTeamInfo } from "./domjudge-scoreboard";

test("school aliases share a logo, affiliation filter and country while preserving the team's registered name", () => {
  const fields = organizationFields(" 北岭大学 ", " 北岭大学\r\n北岭\n北岭 ", "north", "cn");
  assert.deepEqual(fields, { schools: ["北岭大学", "北岭"], id: "north", country: "CN" });
  const directory = indexOrganizations([{ ...fields, key: "north", version: 1, logoHash: "logo" }]);
  const teams = ["北岭大学", " 北岭 ", "另一所学校"].map(school => boardTeamInfo({ school, category: "2" }, directory));
  assert.deepEqual(teams.map(t => [t.school, t.affiliationId, t.logoHash]), [
    ["北岭大学", "north", "logo"], ["北岭", "north", "logo"], ["另一所学校", "", undefined],
  ]);
  assert.equal(boardFilters(teams.slice(0, 2), {}).length, 0);
  assert.equal(boardFilters(teams, {})[0].options.length, 2);
  assert.equal(matchOrganization({}, "constructor"), undefined);
  assert.throws(() => organizationFields(" ", "", "", ""));
  assert.throws(() => organizationFields("Team", "", "", "China"));
});

test("organization uploads are decoded and resized to versioned WebP images", async () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="red"/></svg>';
  const file = new File([source], "school.svg", { type: "image/svg+xml" });
  const result = await readOrganizationLogo(file);
  const metadata = await sharp(result.data).metadata();
  assert.deepEqual([metadata.format, metadata.width, metadata.height], ["webp", 192, 96]);
  assert.match(result.hash, /^[a-f0-9]{64}$/);
  assert.equal((await readOrganizationLogo(file)).hash, result.hash);
  await assert.rejects(readOrganizationLogo(new File(["not an image"], "school.png")), /image/);
  await assert.rejects(readOrganizationLogo(new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.png")), /size/);
});
