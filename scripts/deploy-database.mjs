import "dotenv/config";
import pg from "pg";
import { requirePrismaSuccess, runPrisma } from "./prisma-cli.mjs";

const BASELINE = "00000000000000_baseline";
const quote = (name) => `"${name.replaceAll('"', '""')}"`;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL before running npm run db:deploy.");
  const url = new URL(process.env.DATABASE_URL);
  const schema = url.searchParams.get("schema") || "public";
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const lock = await client.query(
      "SELECT pg_try_advisory_lock(hashtext(current_database()), hashtext($1)) AS acquired",
      [`novajudge-deploy:${schema}`],
    );
    if (!lock.rows[0].acquired) throw new Error("Another NovaJudge database deployment is running.");

    const { rows: tables } = await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = $1", [schema],
    );
    const hasHistory = tables.some((table) => table.tablename === "_prisma_migrations");
    let baselineApplied = false;
    if (hasHistory) {
      const { rows: migrations } = await client.query(
        `SELECT migration_name, finished_at, rolled_back_at FROM ${quote(schema)}."_prisma_migrations"`,
      );
      if (migrations.some((migration) => !migration.finished_at && !migration.rolled_back_at)) {
        throw new Error("An unfinished migration exists. Investigate it before deploying; no automatic reset is performed.");
      }
      baselineApplied = migrations.some((migration) => migration.migration_name === BASELINE && migration.finished_at);
    }

    if (!baselineApplied && tables.some((table) => table.tablename !== "_prisma_migrations")) {
      // Old editions used db push and did not have a complete migration history.
      // Only adopt a database that exactly matches one of the shipped schemas.
      let matched;
      for (const snapshot of ["prisma/legacy-schemas/public.prisma", "prisma/legacy-schemas/internal.prisma", "prisma/schema.prisma"]) {
        const result = runPrisma(["migrate", "diff", "--from-config-datasource", "--to-schema", snapshot, "--exit-code"]);
        if (result.status === 0) { matched = snapshot; break; }
        if (result.status !== 2) {
          if (result.stderr) process.stderr.write(result.stderr);
          throw new Error("Unable to inspect the existing database schema.");
        }
      }
      if (!matched) {
        throw new Error("Unsupported existing schema. Compare it with prisma/legacy-schemas before adopting it; no database changes were made.");
      }
      console.log(`Recognized ${matched}; recording the existing schema baseline without changing data.`);
      requirePrismaSuccess(["migrate", "resolve", "--applied", BASELINE]);
    }

    requirePrismaSuccess(["migrate", "deploy"]);
    console.log("Database deployment complete. Existing records and sequences are preserved.");
  } finally {
    await client.end(); // Also releases the deployment advisory lock.
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Database deployment failed.");
  process.exitCode = 1;
});
