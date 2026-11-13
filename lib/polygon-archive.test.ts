import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import yaml from "js-yaml";
import { polygonFixture, polygonProtocolFixture, polygonXml } from "../tests/fixtures/polygon";
import { parsePolygonContest, parsePolygonProblems, readImportZip, resolveImportFormat } from "./polygon-archive";

async function loaded(zip: JSZip) { return readImportZip(await zip.generateAsync({ type: "nodebuffer" })); }

test("Polygon root and wrapper packages preserve judging data, HTML math, images, and samples", async () => {
  for (const prefix of ["", "sum-3-linux/"]) {
    const zip = await loaded(polygonFixture(prefix));
    assert.equal(resolveImportFormat(null, zip), "polygon");
    const [problem] = await parsePolygonProblems(zip);
    const { data, files } = problem.archive;
    assert.equal(data.title, "A & B");
    assert.equal(data.defaultTimeLimit, 1500);
    assert.equal(data.defaultMemoryLimit, 256);
    assert.equal(data.type, "spj");
    assert.deepEqual(data.samples, [{ input: "1 2\n", output: "3\n" }]);
    const config = { type: "spj", checker: "checker.cpp", cases: [{ input: "001.in", output: "001.out" }, { input: "002.in", output: "002.out" }] };
    assert.deepEqual(data.judgeConfig, config);
    assert.deepEqual(yaml.load(files.get("data/problem.yml")!.toString()), config);
    assert.equal(files.get("data/002.in")!.toString(), "-7 10\n");
    assert.match(files.get("data/checker.cpp")!.toString(), /registerTestlibCmd/);
    assert.deepEqual(data.sections.map((section) => section.title), ["Problem Description", "Input", "Output"]);
    assert.equal(data.sections[1].content, "Two integers.");
    assert.equal(data.sections[2].content, "Their sum.");
    const markdown = data.sections[0].content;
    assert.match(markdown, /\$a_i \\le b_i \\cdot 2\$/);
    assert.match(markdown, /\$\$\n\\sum_\{i=1\}\^\{n\} a_i < 10\n\$\$/);
    assert.doesNotMatch(markdown, /## Input|Two integers\.|Their sum\./);
    assert.match(markdown, /\/api\/problems\/0\/assets\/[a-f0-9]+\.png/);
    assert.doesNotMatch(markdown, /script|onerror|seconds|never import|sample-tests/i);
    assert.equal([...files.keys()].filter((name) => name.startsWith("assets/")).length, 1);
    assert.deepEqual(problem.warnings, []);
  }
});

test("imports wrapped and custom sections as ordered Blocks, including repeated communication Input/Output", async () => {
  const zip = polygonFixture();
  zip.file("statements/.html/english/problem.html", `<div class="problem-statement">
    <div class="header">Title and limits</div>
    <div class="layout">
      <div><p>Anonymous problem description.</p><h3>A nested heading</h3><p>Still description.</p></div>
      <div><div class="section-title">First Run</div><p>Encode the message.</p></div>
      <div class="input-specification"><div class="section-title">Input</div><p>First input $$$x &lt; 4$$$.</p><img src="figure.png"></div>
      <div class="output-specification"><div class="section-title">Output</div><pre><code>## Input\nNot a section boundary</code></pre></div>
      <div><div class="section-title">Second Run</div><p>Decode the message.</p></div>
      <div class="input-specification"><div class="section-title">Input</div><p>Second input.</p></div>
      <div class="output-specification"><div class="section-title">Output</div><p>Second output.</p></div>
      <div class="interaction"><div class="section-title">Interaction</div><p>Flush after every query.</p></div>
      <div class="note"><div class="section-title">Note</div><p>Remember this.</p><div><div class="section-title">Nested note</div><p>Keep this heading.</p></div></div>
      <p>A trailing explanation.</p>
    </div>
  </div>`);
  const [{ archive }] = await parsePolygonProblems(await loaded(zip));
  const sections = archive.data.sections;
  assert.deepEqual(sections.map((section) => section.title), [
    "Problem Description", "First Run", "Input", "Output", "Second Run", "Input", "Output", "Interaction", "Note",
  ]);
  assert.match(sections[0].content, /### A nested heading/);
  assert.match(sections[0].content, /Still description/);
  assert.equal(sections[1].content, "Encode the message.");
  assert.match(sections[2].content, /First input \$x < 4\$/);
  assert.match(sections[2].content, /\/api\/problems\/0\/assets\//);
  assert.match(sections[3].content, /```\n## Input\nNot a section boundary\n```/);
  assert.equal(sections[4].content, "Decode the message.");
  assert.equal(sections[5].content, "Second input.");
  assert.equal(sections[6].content, "Second output.");
  assert.equal(sections[7].content, "Flush after every query.");
  assert.match(sections[8].content, /## Nested note/);
  assert.match(sections[8].content, /A trailing explanation\./);
  assert.doesNotMatch(JSON.stringify(sections), /Title and limits/);
});

test("unstructured HTML keeps all content in a fallback Block without guessing from Markdown headings", async () => {
  const zip = polygonFixture();
  zip.file("statements/.html/english/problem.html", '<p>Opening paragraph.</p><h2>Input</h2><p>Custom statement layout.</p>');
  const [{ archive }] = await parsePolygonProblems(await loaded(zip));
  assert.deepEqual(archive.data.sections, [{
    title: "Problem Description", content: "Opening paragraph.\n\n## Input\n\nCustom statement layout.",
  }]);
});

test("uses Chinese when available and reads statement examples without losing whitespace", async () => {
  const zip = polygonFixture("", polygonXml.replace("</statements>", '<statement charset="UTF-8" language="chinese" path="statements/chinese/problem.html" type="text/html"/></statements>'));
  zip.file("statements/chinese/problem.html", "<p>计算两个数的和。</p>");
  zip.file("statements/chinese/problem-properties.json", JSON.stringify({ sampleTests: [{ input: " 1 2\n\n", output: "3\n" }] }));
  const [result] = await parsePolygonProblems(await loaded(zip));
  assert.equal(result.archive.data.sections[0].content, "计算两个数的和。");
  assert.equal(result.archive.data.samples[0].input, " 1 2\n\n");
});

test("supports Windows separators and decimal test patterns", async () => {
  const zip = polygonFixture("", polygonXml.replaceAll("tests/%02d", "tests\\%d")
    .replace("statements/.html/english/problem.html", "statements\\.html\\english\\problem.html"));
  for (const [source, destination] of [["tests/01", "tests\\1"], ["tests/01.a", "tests\\1.a"], ["tests/02", "tests\\2"], ["tests/02.a", "tests\\2.a"]]) {
    zip.file(destination, await zip.file(source)!.async("nodebuffer"), { createFolders: false });
    zip.remove(source);
  }
  const [result] = await parsePolygonProblems(await loaded(zip));
  assert.equal(result.archive.files.get("data/002.out")!.toString(), "3\n");
});

test("inlines local checker headers without needing changes to the judge compiler", async () => {
  const zip = polygonFixture();
  zip.file("files/check.cpp", '#include "testlib.h"\n#include "helpers/value.h"\nint main() {}');
  zip.file("files/helpers/value.h", "const int value = 3;");
  const [result] = await parsePolygonProblems(await loaded(zip));
  assert.match(result.archive.files.get("data/checker.cpp")!.toString(), /const int value = 3/);
  assert.doesNotMatch(result.archive.files.get("data/checker.cpp")!.toString(), /helpers\/value/);
});

test("PDF-only statements are copied with a visible warning", async () => {
  const zip = polygonFixture("", polygonXml.replace("text/html", "application/pdf").replace("problem.html", "problem.pdf"));
  zip.file("statements/.html/english/problem.pdf", "%PDF-1.4");
  const [result] = await parsePolygonProblems(await loaded(zip));
  assert.match(result.archive.data.sections[0].content, /Download problem statement \(PDF\)/);
  assert.match(result.warnings[0], /No HTML/);
});

test("headerless HTML tables retain content without retaining executable HTML", async () => {
  const zip = polygonFixture();
  zip.file("statements/.html/english/problem.html", '<table onclick="alert(1)"><tr><td>A</td><td>B</td></tr><tr><td><img src="figure.png" onerror="alert(1)"></td><td>2</td></tr></table><table></table>');
  const [result] = await parsePolygonProblems(await loaded(zip));
  const markdown = result.archive.data.sections[0].content;
  assert.match(markdown, /\| A \| B \|/);
  assert.match(markdown, /\| --- \| --- \|/);
  assert.match(markdown, /\/api\/problems\/0\/assets/);
  assert.doesNotMatch(markdown, /onclick|onerror|<table|<img/);
});

test("incomplete generated data, bad metadata, and unsupported judging are rejected", async () => {
  const incomplete = polygonFixture();
  incomplete.remove("tests/02.a");
  await assert.rejects(parsePolygonProblems(await loaded(incomplete)), /tests\/02.a.*Linux or Windows/);
  const cases: [string, RegExp][] = [
    [polygonXml.replace("<time-limit>1500", "<time-limit>0"), /time limit/],
    [polygonXml.replace("<test-count>2", "<test-count>3"), /test-count/],
    [polygonXml.replace("%02d", "%s"), /path pattern/],
    [polygonXml.replace("tests/%02d", "../tests/%02d"), /path/],
    [polygonXml.replace('input-file=""', 'input-file="sum.in"'), /file I\/O/],
    [polygonXml.replace('run-count="1"', 'run-count="3"'), /run-count/],
    [polygonXml.replace("<assets>", "<assets><interactor/>"), /interactor source is missing/],
    [polygonXml.replace('method="manual"', 'method="manual" points="10"'), /partial scores/],
    [polygonXml.replace('cpp.g++17', 'java'), /C\+\+/],
    [polygonXml.replace("<names>", "<names><broken>"), /invalid XML/],
    [polygonXml.replace("<problem ", '<!DOCTYPE problem [<!ENTITY x "value">]><problem '), /DTD/],
  ];
  for (const [xml, expected] of cases) await assert.rejects(parsePolygonProblems(await loaded(polygonFixture("", xml))), expected);
});

test("zero-valued Polygon point metadata is accepted for ordinary, interactive and communication problems", async () => {
  for (const [runCount, runs] of [[1, []], [1, [1]], [2, [1]]] as const) {
    for (const points of ["0", "0.0", "0.000", "0e10"]) {
      const zip = polygonProtocolFixture(runCount, [...runs]);
      const xml = (await zip.file("problem.xml")!.async("text"))
        .replaceAll('<test method=', `<test points="${points}" method=`)
        .replace('<tests>', '<groups/><tests>');
      zip.file("problem.xml", xml);
      const [problem] = await parsePolygonProblems(await loaded(zip));
      const config = problem.archive.data.judgeConfig as Record<string, unknown>;
      assert.equal(problem.archive.data.type, runCount === 2 ? "communication" : runs.length ? "interactive" : "spj");
      assert.equal((config.cases as unknown[]).length, 2, "zero points must not remove tests from judging");
      assert.equal(problem.archive.files.get("data/001.in")!.toString(), "1 2\n");
      assert.equal(problem.archive.files.get("data/002.out")!.toString(), "3\n");
    }
  }
});

test("zero point metadata does not bypass actual scoring rules or malformed values", async () => {
  for (const points of ["1", "0.01", "1e-9999"]) {
    const xml = polygonXml.replace('method="manual"', 'method="manual" points="0.0"')
      .replace('method="generated"', `method="generated" points="${points}"`);
    await assert.rejects(parsePolygonProblems(await loaded(polygonFixture("", xml))), /partial scores/);
  }
  for (const points of ["", "NaN", "Infinity", "-1", "0x0"]) {
    const xml = polygonXml.replace('method="manual"', `method="manual" points="${points}"`);
    await assert.rejects(parsePolygonProblems(await loaded(polygonFixture("", xml))), /Invalid Polygon test points/);
  }
  const zeroPoints = polygonXml.replaceAll('<test method=', '<test points="0.0" method=');
  for (const xml of [
    zeroPoints.replace('<tests>', '<groups><group name="g1" points="100"/></groups><tests>'),
    zeroPoints.replace('<judging ', '<judging treat-points-from-checker-as-percent="true" '),
  ]) await assert.rejects(parsePolygonProblems(await loaded(polygonFixture("", xml))), /partial scores/);
});

for (const [runCount, interactorRuns, type] of [
  [1, [1], "interactive"], [2, [], "communication"], [2, [1], "communication"], [2, [1, 2], "communication"],
] as const) {
  test(`imports Polygon ${type} with ${runCount} run(s), interaction on ${interactorRuns}`, async () => {
    const zip = polygonProtocolFixture(runCount, [...interactorRuns], "wrapped/");
    zip.file("wrapped/tests/01", "PRIVATE JUDGE INPUT");
    zip.file("wrapped/tests/01.a", "PRIVATE JUDGE ANSWER");
    const [result] = await parsePolygonProblems(await loaded(zip));
    const { data, files } = result.archive;
    assert.equal(data.type, type);
    const config = yaml.load(files.get("data/problem.yml")!.toString()) as Record<string, unknown>;
    assert.deepEqual(config, data.judgeConfig as Record<string, unknown>);
    assert.deepEqual(config.polygon, { run_count: runCount, interactor_runs: interactorRuns, sample_cases: [1] });
    assert.equal(config.checker, "checker.cpp");
    assert.equal(config.communicator, undefined);
    assert.equal(config.interactor, interactorRuns.length ? "interactor.cpp" : undefined);
    assert.equal(files.has("data/interactor.cpp"), interactorRuns.length > 0);
    assert.deepEqual(data.samples, [], "private judge input must not become a public sample");
    assert.deepEqual(data.sections.map((section) => section.title), ["Problem Description", "Input", "Output", "Examples"]);
    assert.match(data.sections[3].content, /1 2/);
    assert.doesNotMatch(JSON.stringify(data.sections), /PRIVATE JUDGE/);
  });
}

test("legacy interactor descriptors default to the first invocation and inline helper headers", async () => {
  const zip = polygonProtocolFixture(1, [1]);
  zip.file("problem.xml", (await zip.file("problem.xml")!.async("text")).replace(/<runs>[\s\S]*?<\/runs>/, ""));
  zip.file("files/interactor.cpp", '#include "testlib.h"\n#include "helper.h"\nint main() {}');
  zip.file("files/helper.h", "const int interactiveHelper = 1;");
  const [result] = await parsePolygonProblems(await loaded(zip));
  assert.match(result.archive.files.get("data/interactor.cpp")!.toString(), /interactiveHelper/);
  assert.deepEqual((result.archive.data.judgeConfig as Record<string, unknown>).polygon,
    { run_count: 1, interactor_runs: [1], sample_cases: [1] });
});

test("interactive examples from properties are preserved when HTML has no examples", async () => {
  const zip = polygonProtocolFixture(2, [1, 2]);
  zip.file("statements/.html/english/problem.html", "<p>Two interactive runs.</p>");
  zip.file("statements/english/problem-properties.json", JSON.stringify({ sampleTests: [{ input: "public query", output: "public response" }] }));
  const [result] = await parsePolygonProblems(await loaded(zip));
  assert.deepEqual(result.archive.data.sections.map((section) => section.title), ["Problem Description", "Examples"]);
  assert.equal(result.archive.data.sections[0].content, "Two interactive runs.");
  assert.match(result.archive.data.sections[1].content, /public query/);
  assert.match(result.archive.data.sections[1].content, /public response/);
  assert.deepEqual(result.archive.data.samples, []);
});

test("rejects invalid interactor invocations and missing C++ sources", async () => {
  for (const runs of ["", "<run>2</run>", "<run>1</run><run>1</run>", "<run>3</run>", "<run>abc</run>"]) {
    const zip = polygonProtocolFixture(2, [1]);
    zip.file("problem.xml", (await zip.file("problem.xml")!.async("text")).replace("<run>1</run>", runs));
    await assert.rejects(parsePolygonProblems(await loaded(zip)), /interactor|interactor_runs/i);
  }
  const invalidRun = polygonProtocolFixture(1, [1, 2]);
  await assert.rejects(parsePolygonProblems(await loaded(invalidRun)), /interactor_runs/);
  const missing = polygonProtocolFixture(2, [1]);
  missing.remove("files/interactor.cpp");
  await assert.rejects(parsePolygonProblems(await loaded(missing)), /Missing.*interactor.cpp/);
});

test("unsafe ZIP names, duplicate names, and escaping HTML assets are rejected", async () => {
  for (const name of ["../escape", "C:/escape", "bad/CON.txt"]) {
    const zip = polygonFixture();
    zip.file(name, "unsafe", { createFolders: false });
    await assert.rejects(loaded(zip), /path/);
  }
  const duplicate = polygonFixture();
  duplicate.file("PROBLEM.XML", polygonXml);
  await assert.rejects(loaded(duplicate), /Duplicate/);
  const escaping = polygonFixture();
  escaping.file("statements/.html/english/problem.html", '<img src="../../../tests/01">');
  await assert.rejects(parsePolygonProblems(await loaded(escaping)), /outside statement/);
  await assert.rejects(readImportZip(Buffer.from("not a zip")), /damaged ZIP/);
});

test("contest.xml URLs preserve problem order and indices, not directory order", async () => {
  const zip = polygonFixture("contest/problems/sum/");
  const second = polygonFixture("contest/problems/another/", polygonXml.replaceAll("/example/sum", "/example/another").replace('short-name="sum"', 'short-name="another"'));
  for (const [name, entry] of Object.entries(second.files)) zip.file(name, await entry.async("nodebuffer"), { createFolders: false });
  zip.file("contest/contest.xml", `<contest><names><name language="english" value="Training"/></names><problems>
    <problem index="b" url="https://polygon.codeforces.com/p/example/sum"/>
    <problem index="a" url="https://polygon.codeforces.com/p/example/another"/>
  </problems></contest>`);
  const result = await parsePolygonContest(await loaded(zip), "input.zip");
  assert.equal(result.title, "Training");
  assert.deepEqual(result.problems.map((problem) => problem.displayId), ["B", "A"]);
});

test("contest supports relative problem paths and nested downloaded packages", async () => {
  const zip = new JSZip();
  zip.file("contest/packages/a.zip", await polygonFixture("sum/").generateAsync({ type: "nodebuffer" }));
  zip.file("contest/contest.xml", '<contest><problems><problem index="A" path="packages/a.zip"/></problems></contest>');
  const result = await parsePolygonContest(await loaded(zip), "Round.zip");
  assert.equal(result.title, "Round");
  assert.equal(result.problems.length, 1);
  const folders = polygonFixture("contest/problems/sum/");
  folders.file("contest/contest.xml", '<contest><problems><problem index="A" path="problems/sum"/></problems></contest>');
  assert.equal((await parsePolygonContest(await loaded(folders), "Round.zip")).problems.length, 1);
});

test("loose packages get stable alphabetical labels and unresolved references fail", async () => {
  const zip = new JSZip();
  zip.file("10.zip", await polygonFixture().generateAsync({ type: "nodebuffer" }));
  zip.file("2.zip", await polygonFixture().generateAsync({ type: "nodebuffer" }));
  const loadedZip = await loaded(zip);
  assert.deepEqual((await parsePolygonContest(loadedZip, "practice.zip")).problems.map((problem) => problem.displayId), ["A", "B"]);
  loadedZip.file("contest.xml", '<contest><problems><problem index="A" url="https://polygon.codeforces.com/p/example/missing"/></problems></contest>');
  await assert.rejects(parsePolygonContest(loadedZip, "practice.zip"), /Cannot uniquely resolve/);
  assert.equal(resolveImportFormat("native", loadedZip), "native");
  assert.throws(() => resolveImportFormat("bad", loadedZip), /Unknown import format/);
});
