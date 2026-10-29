// Run from the isolated NovaJudge checkout after installing its dependencies.
// Writes only new fixture files; never touches the database or uploads directory.
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

const directory = path.resolve(".local/windows-e2e-fixture");
await fs.mkdir(directory, { recursive: true });
const cases = [{ input: "1.in", output: "1.out" }, { input: "2.in", output: "2.out" }];
const zip = new JSZip();
const problem = zip.folder("windows_e2e_ab");
problem.file("problem.json", JSON.stringify({
  title: "Windows E2E A+B", type: "default", defaultTimeLimit: 1000, defaultMemoryLimit: 256,
  sections: [{ title: "Description", content: "输入两个整数 a、b（绝对值不超过 10^9），输出 a+b。" }],
  samples: [{ input: "2 3\n", output: "5\n" }], judgeConfig: { type: "default", cases },
}, null, 2));
problem.file("data/1.in", "2 3\n"); problem.file("data/1.out", "5\n");
problem.file("data/2.in", "-1000000000 999999999\n"); problem.file("data/2.out", "-1\n");
problem.file("data/problem.yml", "type: default\ncases:\n  - input: 1.in\n    output: 1.out\n  - input: 2.in\n    output: 2.out\n");
problem.folder("assets");
await fs.writeFile(path.join(directory, "A-plus-B.zip"), await zip.generateAsync({ type: "nodebuffer" }), { flag: "wx" });
await fs.writeFile(path.join(directory, "A.cpp"), '#include <iostream>\n// Windows 监考联调\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}\n', { flag: "wx" });
console.log(`Import ${path.join(directory, "A-plus-B.zip")} using the problem bank's Import button.`);
console.log(`Submission source: ${path.join(directory, "A.cpp")}`);
