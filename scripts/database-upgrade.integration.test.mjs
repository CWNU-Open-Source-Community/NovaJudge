import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";
import pg from "pg";
import { projectRoot, runPrisma } from "./prisma-cli.mjs";

const baseUrl = process.env.TEST_DATABASE_URL;
if (!baseUrl) throw new Error("Set TEST_DATABASE_URL to a PostgreSQL database where disposable test schemas may be created.");

function deploy(env) {
  return spawnSync(process.execPath, ["scripts/deploy-database.mjs"], {
    cwd: projectRoot, env, encoding: "utf8", windowsHide: true,
  });
}

function successful(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

for (const edition of ["fresh", "public", "internal", "internal-history", "unrecognized"]) {
  test(`${edition}: database adoption preserves records, settings, sequences and supports repeat deployments`, async () => {
    const schema = `nj_upgrade_test_${randomBytes(10).toString("hex")}`;
    const url = new URL(baseUrl);
    url.searchParams.set("schema", schema);
    const env = { ...process.env, DATABASE_URL: url.toString() };
    const internal = edition.startsWith("internal");
    const client = new pg.Client({ connectionString: baseUrl });
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      if (edition !== "fresh") {
        successful(runPrisma(["db", "push", "--schema", `prisma/legacy-schemas/${internal ? "internal" : "public"}.prisma`], env));
        await client.query(`
          INSERT INTO global_users (id, username, role, "updatedAt") VALUES ('keep-user', 'existing-user', 'GLOBAL_USER', now());
          INSERT INTO problems (id, title, "defaultTimeLimit", "defaultMemoryLimit", sections, samples, "updatedAt")
            VALUES (53, 'Existing problem', 1000, 256, '[{"title":"Input","content":"keep markdown"}]', '[]', now());
          INSERT INTO contests (id, title, "startTime", "endTime", "updatedAt")
            VALUES (1000, 'Existing contest', now() - interval '5 hours', now(), now());
          INSERT INTO users (id, username, password, "contestId", "updatedAt")
            VALUES ('keep-team', 'team', 'existing-password-hash', 1000, now());
          INSERT INTO submissions (id, "globalUserId", "contestId", "problemId", language, code, "codeLength", verdict)
            VALUES ('keep-submission', 'keep-user', 1000, 53, 'cpp', 'keep source code', 16, 'ACCEPTED');
          INSERT INTO api_keys (id, key, "userId") VALUES ('keep-key', 'fixture-key', 'keep-user');
          SELECT setval(pg_get_serial_sequence('problems', 'id'), 64, true);
        `);
        if (internal) {
          await client.query(`
            UPDATE global_users SET "externalId" = 'school-account', "isBanned" = true WHERE id = 'keep-user';
            INSERT INTO system_settings (id, "allowExternalLogin", "updatedAt") VALUES ('default', true, now());
          `);
        }
        if (edition === "internal-history") {
          await client.query(`
            CREATE TABLE _prisma_migrations (
              id VARCHAR(36) PRIMARY KEY, checksum VARCHAR(64) NOT NULL,
              finished_at TIMESTAMPTZ, migration_name VARCHAR(255) NOT NULL,
              logs TEXT, rolled_back_at TIMESTAMPTZ,
              started_at TIMESTAMPTZ NOT NULL DEFAULT now(), applied_steps_count INTEGER NOT NULL DEFAULT 0
            );
            INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count)
              VALUES ('legacy-history', 'legacy-checksum', now(), '20261013000000_proctored_logins', 1);
          `);
        }
      }

      const original = edition !== "fresh" ? await snapshot(client) : null;
      if (edition === "unrecognized") {
        await client.query('ALTER TABLE problems ADD COLUMN "customField" TEXT');
        const unrecognizedSnapshot = await snapshot(client);
        const result = deploy(env);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Unsupported existing schema/);
        assert.deepEqual(await snapshot(client), unrecognizedSnapshot);
        assert.equal((await client.query("SELECT to_regclass('_prisma_migrations') AS history")).rows[0].history, null);
        return;
      }

      successful(deploy(env));
      successful(deploy(env));
      successful(runPrisma(["migrate", "status"], env));
      successful(runPrisma(["migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code"], env));
      if (original) {
        assert.deepEqual(await snapshot(client), original);
        assert.equal((await client.query("SELECT nextval(pg_get_serial_sequence('problems', 'id')) AS id")).rows[0].id, "65");
      }
      if (internal) {
        assert.deepEqual((await client.query('SELECT "externalId", "isBanned" FROM global_users WHERE id = $1', ['keep-user'])).rows,
          [{ externalId: "school-account", isBanned: true }]);
        assert.equal((await client.query("SELECT \"allowExternalLogin\" FROM system_settings WHERE id = 'default'")).rows[0].allowExternalLogin, true);
      }
      await client.query("INSERT INTO system_settings (id, \"updatedAt\") VALUES ('new-setting', now())");
      assert.equal((await client.query("SELECT \"allowExternalLogin\" FROM system_settings WHERE id = 'new-setting'")).rows[0].allowExternalLogin, false);
      const history = (await client.query('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name')).rows;
      assert.deepEqual(history.map((row) => row.migration_name), ["00000000000000_baseline",
        ...(edition === "internal-history" ? ["20261013000000_proctored_logins"] : []),
        "20261117000000_unified_deployment"]);
    } finally {
      // Only the freshly generated test namespace can be removed.
      if (!/^nj_upgrade_test_[0-9a-f]{20}$/.test(schema)) throw new Error("Invalid cleanup target");
      await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA "${schema}" CASCADE`);
      await client.end();
    }
  });
}

async function snapshot(client) {
  const tables = ["problems", "contests", "users", "submissions", "api_keys"];
  const result = {};
  for (const table of tables) result[table] = (await client.query(`SELECT to_jsonb(t) AS record FROM "${table}" t ORDER BY id`)).rows;
  result.global_users = (await client.query('SELECT id, username, password, role, "createdAt", "updatedAt" FROM global_users ORDER BY id')).rows;
  return result;
}
