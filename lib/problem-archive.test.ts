import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { parseSingleProblemArchive, ProblemArchiveError } from "./problem-archive";

const metadata = {
  id: 12,
  title: "A + B",
  type: "default",
  defaultTimeLimit: 1000,
  defaultMemoryLimit: 256,
  sections: [{ title: "Description", content: "Add two numbers." }],
  samples: [{ input: "1 2\n", output: "3\n" }],
};

async function archive(source: unknown = metadata, prefix = "", extra?: (zip: JSZip) => void) {
  const zip = new JSZip();
  zip.file(`${prefix}problem.json`, JSON.stringify(source), { createFolders: false });
  extra?.(zip);
  return zip.generateAsync({ type: "nodebuffer" });
}

test("reads the existing export layout, root metadata, and nested wrappers without directory records", async () => {
  for (const prefix of ["", "problem_12_A + B/", "downloads/wrapper/problem_12_A + B/"]) {
    const buffer = await archive(metadata, prefix, (zip) => {
      zip.file(`${prefix}data/1.in`, "1 2\n", { createFolders: false });
      zip.file(`${prefix}assets/chart.png`, Buffer.from([0, 255, 128, 10]), { createFolders: false });
      zip.file("unrelated/readme.txt", "ignore", { createFolders: false });
    });
    const result = await parseSingleProblemArchive(buffer, 99);
    assert.equal(result.data.title, metadata.title);
    assert.equal("id" in result.data, false);
    assert.deepEqual(result.data.samples, metadata.samples);
    assert.equal(result.files.get("data/1.in")?.toString(), "1 2\n");
    assert.deepEqual(result.files.get("assets/chart.png"), Buffer.from([0, 255, 128, 10]));
    assert.equal(result.files.size, 2);
  }
  const zip = new JSZip();
  const folder = zip.folder("problem_12_A + B")!;
  folder.file("problem.json", JSON.stringify(metadata));
  folder.folder("data")!.file("1.out", "3\n");
  const buffer = await zip.generateAsync({ type: "arraybuffer" });
  assert.equal((await parseSingleProblemArchive(buffer, 99)).files.get("data/1.out")?.toString(), "3\n");
});

test("requires exactly one metadata file before parsing even when a second problem is malformed", async () => {
  const zip = new JSZip();
  zip.file("problem.json/", "", { dir: true });
  zip.file("data/1.in", "1");
  await assert.rejects(parseSingleProblemArchive(await zip.generateAsync({ type: "nodebuffer" }), 99), /exactly one.*found 0/);
  for (const second of [JSON.stringify(metadata), "{bad json", "null"]) {
    const buffer = await archive(metadata, "first/", (other) => other.file("second/problem.json", second, { createFolders: false }));
    await assert.rejects(parseSingleProblemArchive(buffer, 99), /exactly one.*found 2/);
  }
  const rootAndNested = await archive(metadata, "", (other) => other.file("child/problem.json", "{}"));
  await assert.rejects(parseSingleProblemArchive(rootAndNested, 99), /exactly one.*found 2/);
});

test("invalid ZIPs, JSON, metadata, limits, and samples produce client errors", async () => {
  await assert.rejects(parseSingleProblemArchive(Buffer.from("not a zip"), 99), ProblemArchiveError);
  const zip = new JSZip();
  zip.file("problem.json", "{bad json");
  await assert.rejects(parseSingleProblemArchive(await zip.generateAsync({ type: "nodebuffer" }), 99), /valid JSON/);
  zip.file("problem.json", JSON.stringify({ ...metadata, judgeConfig: { limit: "overflow" } }).replace('"overflow"', "1e400"));
  await assert.rejects(parseSingleProblemArchive(await zip.generateAsync({ type: "nodebuffer" }), 99), /valid JSON/);
  const invalid = [
    null, [], "problem", {},
    ...["", "  ", null, 12].map((title) => ({ ...metadata, title })),
    { ...metadata, type: "unknown" },
    ...[0, -1, 1.2, 2147483648, "1000", null].flatMap((value) => [
      { ...metadata, defaultTimeLimit: value }, { ...metadata, defaultMemoryLimit: value }, { ...metadata, id: value },
    ]),
    { ...metadata, sections: null }, { ...metadata, sections: [{}] },
    { ...metadata, sections: [{ title: "x", content: 4 }] },
    { ...metadata, samples: null }, { ...metadata, samples: [{ input: 12, output: "" }] },
    { ...metadata, samples: [{ input: "", output: "", communication: {} }] },
    { ...metadata, hint: [] }, { ...metadata, judgeConfig: [] }, { ...metadata, judgeConfig: true },
  ];
  for (const source of invalid) {
    await assert.rejects(parseSingleProblemArchive(await archive(source), 99), ProblemArchiveError);
  }
});

test("remaps exported problem resource references without retaining the exported ID", async () => {
  const source = { ...metadata,
    sections: [{ title: "/api/problems/12/assets/title.png", content: "![](/api/problems/12/assets/a.png) /api/problems/123/assets/b.png" }],
    hint: "/api/problems/12/assets/hint.png /api/problems/12/data/1.in",
  };
  const { data } = await parseSingleProblemArchive(await archive(source), 99);
  assert.deepEqual(data.sections, [{ title: "/api/problems/99/assets/title.png", content: "![](/api/problems/99/assets/a.png) /api/problems/123/assets/b.png" }]);
  assert.equal(data.hint, "/api/problems/99/assets/hint.png /api/problems/99/data/1.in");
  assert.equal("id" in data, false);
  const withoutId = { ...source, id: undefined };
  assert.deepEqual((await parseSingleProblemArchive(await archive(withoutId), 99)).data.sections, source.sections);
});

test("missing optional fields clear previous values; exported object/string configs and incomplete drafts remain valid", async () => {
  const empty = await parseSingleProblemArchive(await archive(metadata), 99);
  assert.equal(empty.data.hint, null);
  assert.equal(empty.data.judgeConfig, null);
  for (const judgeConfig of [null, {}, { cases: [], type: "communication" }, "type: default\ncases: []\n"]) {
    const source = { ...metadata, hint: null, judgeConfig, type: "communication", sections: [], samples: [] };
    assert.deepEqual((await parseSingleProblemArchive(await archive(source), 99)).data.judgeConfig, judgeConfig);
  }
});

test("communication samples retain both run examples, private reference answers, and whitespace", async () => {
  const samples = [{ input: "first\n1 2\n", output: "private\n", communication: {
    firstOutput: "2 1\n", secondInput: "second\n2 1\n", secondOutput: "1 2\n",
  } }];
  const result = await parseSingleProblemArchive(await archive({ ...metadata, type: "communication", samples }), 99);
  assert.deepEqual(result.data.samples, samples);
});

test("rejects traversal, absolute, reserved, and ambiguous paths before extraction", async () => {
  for (const name of ["../evil.txt", "root/data/../../evil.txt", "root/data/..\\evil.txt",
    "/absolute.txt", "C:/absolute.txt", "root/data/NUL.txt", "root/data/evil. ", "root/assets/x\0.png"]) {
    const buffer = await archive(metadata, "root/", (zip) => zip.file(name, "bad", { createFolders: false }));
    await assert.rejects(parseSingleProblemArchive(buffer, 99), ProblemArchiveError, name);
  }
  const metadataTraversal = await archive(metadata, "../");
  await assert.rejects(parseSingleProblemArchive(metadataTraversal, 99), /Invalid archive path/);
});

test("rejects flattened basename collisions, case collisions, and file-directory conflicts", async () => {
  for (const names of [
    ["root/data/a/1.in", "root/data/b/1.in"],
    ["root/assets/a.png", "root/assets/A.PNG"],
    ["root/data/a", "root/data/a/1.in"],
    ["root/data/a/", "root/data/a"],
    ["root/data"], ["root/assets"],
  ]) {
    const buffer = await archive(metadata, "root/", (zip) => {
      for (const name of names) zip.file(name, "x", { createFolders: false });
    });
    await assert.rejects(parseSingleProblemArchive(buffer, 99), ProblemArchiveError, names.join(", "));
  }
});

test("rejects duplicate ZIP records before JSZip can silently overwrite them", async () => {
  // JSZip's writer prevents duplicate names, so rename equal-length filenames in a real ZIP.
  for (const names of [["a/problem.json", "b/problem.json"], ["data/one.in", "data/two.in"]]) {
    const zip = new JSZip();
    if (!names[0].endsWith("problem.json")) zip.file("problem.json", JSON.stringify(metadata));
    for (const name of names) zip.file(name, JSON.stringify(metadata), { createFolders: false });
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const from = Buffer.from(names[1]);
    const to = Buffer.from(names[0]);
    for (let offset = buffer.indexOf(from); offset !== -1; offset = buffer.indexOf(from, offset + to.length)) {
      to.copy(buffer, offset);
    }
    await assert.rejects(parseSingleProblemArchive(buffer, 99), /Duplicate archive path/);
  }
});

test("flattens distinct nested files and only extracts the selected problem's data/assets", async () => {
  const buffer = await archive(metadata, "wrapper/problem/", (zip) => {
    for (const name of ["wrapper/problem/data/sub/1.in", "wrapper/problem/assets/sub/a.png",
      "wrapper/data/ignored.in", "wrapper/problem/readme.txt", "data/ignored.in"]) {
      zip.file(name, name, { createFolders: false });
    }
  });
  assert.deepEqual([... (await parseSingleProblemArchive(buffer, 99)).files.keys()].sort(), ["assets/a.png", "data/1.in"]);
});
