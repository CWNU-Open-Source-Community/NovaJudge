import JSZip from "jszip";

// Compact author-created fixture following Polygon's actual problem.xml/HTML structure.
export const polygonXml = `<?xml version="1.0" encoding="utf-8" standalone="no"?>
<problem revision="3" short-name="sum" url="https://polygon.codeforces.com/p/example/sum">
  <names><name language="english" value="A &amp; B"/></names>
  <statements>
    <statement charset="UTF-8" language="english" path="statements/.html/english/problem.html" type="text/html"/>
  </statements>
  <judging input-file="" output-file="" run-count="1">
    <testset name="tests">
      <time-limit>1500</time-limit><memory-limit>268435456</memory-limit><test-count>2</test-count>
      <input-path-pattern>tests/%02d</input-path-pattern><answer-path-pattern>tests/%02d.a</answer-path-pattern>
      <tests><test method="manual" sample="true"/><test method="generated" cmd="gen 42"/></tests>
    </testset>
  </judging>
  <assets>
    <checker name="std::ncmp.cpp" type="testlib"><source path="files/check.cpp" type="cpp.g++17"/>
      <testset><test-count>99</test-count></testset>
    </checker>
  </assets>
</problem>`;

export const polygonHtml = `<HTML><HEAD><TITLE>A &amp; B</TITLE><SCRIPT>alert('never import')</SCRIPT></HEAD><BODY>
<DIV class="problem-statement"><DIV class="header"><DIV class="title">A &amp; B</DIV><DIV class="time-limit">1.5 seconds</DIV></DIV>
<DIV class="legend"><P>Add $$$a_i$$$ and $$$b_i$$$. Keep $$$a_i \\le b_i \\cdot 2$$$.</P>
<P>$$$$$$\\sum_{i=1}^{n} a_i &lt; 10$$$$$$</P><IMG src="figure.png" onerror="alert('unsafe')"></DIV>
<DIV class="input-specification"><DIV class="section-title">Input</DIV><P>Two integers.</P></DIV>
<DIV class="output-specification"><DIV class="section-title">Output</DIV><P>Their sum.</P></DIV>
<DIV class="sample-tests"><DIV class="sample-test"><DIV class="input"><PRE>1 2</PRE></DIV><DIV class="output"><PRE>3</PRE></DIV></DIV></DIV>
</DIV></BODY></HTML>`;

export const polygonChecker = `#include "testlib.h"
int main(int argc, char* argv[]) {
  registerTestlibCmd(argc, argv);
  long long expected = ans.readLong(), actual = ouf.readLong();
  if (expected != actual) quitf(_wa, "Wrong sum");
  quitf(_ok, "Correct sum");
}`;

export function polygonFixture(prefix = "", xml = polygonXml) {
  const zip = new JSZip();
  const files: Record<string, string | Buffer> = {
    "problem.xml": xml,
    "tests/01": "1 2\n", "tests/01.a": "3\n",
    "tests/02": "-7 10\n", "tests/02.a": "3\n",
    "files/check.cpp": polygonChecker,
    "statements/.html/english/problem.html": polygonHtml,
    "statements/.html/english/figure.png": Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8uoAAAAASUVORK5CYII=", "base64"),
  };
  for (const [name, content] of Object.entries(files)) zip.file(prefix + name, content, { createFolders: false });
  return zip;
}

export function polygonProtocolFixture(runCount: 1 | 2, interactorRuns: (1 | 2)[] = [], prefix = "") {
  const interactor = interactorRuns.length ? `<interactor><source path="files/interactor.cpp" type="cpp.g++17"/>
    <runs>${interactorRuns.map((run) => `<run>${run}</run>`).join("")}</runs></interactor>` : "";
  const xml = polygonXml.replace('run-count="1"', `run-count="${runCount}"`).replace("<assets>", `<assets>${interactor}`);
  const zip = polygonFixture(prefix, xml);
  if (interactor) zip.file(prefix + "files/interactor.cpp", `#include "testlib.h"
int main(int argc, char* argv[]) {
  registerInteraction(argc, argv);
  int a = inf.readInt(), b = inf.readInt();
  std::cout << a << " " << b << std::endl;
  tout << ouf.readInt() << std::endl;
  quitf(_ok, "Interaction finished");
}`);
  return zip;
}

export async function polygonContestFixture() {
  // Reverse directory order to ensure the descriptor, rather than filenames, controls import order.
  const zip = polygonFixture("contest/problems/z-first/", polygonXml.replace('value="A &amp; B"', 'value="First problem"'));
  const second = polygonFixture("contest/problems/a-second/", polygonXml.replace('value="A &amp; B"', 'value="Second problem"'));
  for (const [name, entry] of Object.entries(second.files)) zip.file(name, await entry.async("nodebuffer"), { createFolders: false });
  zip.file("contest/contest.xml", `<contest><names><name language="english" value="Polygon round"/></names><problems>
    <problem index="a" path="problems/z-first"/>
    <problem index="b" path="problems/a-second"/>
  </problems></contest>`);
  return zip;
}
