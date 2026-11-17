import { readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { projectRoot } from "./prisma-cli.mjs";

function findTests(directory) {
  return readdirSync(path.join(projectRoot, directory), { withFileTypes: true }).flatMap((entry) => {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "generated" ? [] : findTests(name);
    return /\.test\.(ts|mjs)$/.test(name) && !name.endsWith(".integration.test.mjs") ? [name] : [];
  });
}

const tests = ["lib", "scripts", "tools/contestant-cli"].flatMap(findTests).sort();
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...tests], {
  cwd: projectRoot, stdio: "inherit", windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
