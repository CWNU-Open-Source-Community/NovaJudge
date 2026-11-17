import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export const projectRoot = fileURLToPath(new URL("../", import.meta.url));

export function runPrisma(args, env = process.env) {
  const result = spawnSync(process.execPath, [require.resolve("prisma/build/index.js"), ...args], {
    cwd: projectRoot,
    env,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

export function requirePrismaSuccess(args, env = process.env) {
  const result = runPrisma(args, env);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`Prisma ${args[0]} ${args[1]} failed (${result.status}).`);
  return result;
}
