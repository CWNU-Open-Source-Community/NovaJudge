import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import yaml from "js-yaml";
import {
  DEFAULT_COMMUNICATION_OUTPUT_LIMIT,
  MAX_COMMUNICATION_OUTPUT_LIMIT,
  getCommunicationOutputLimit,
  isProblemType,
  normalizeProblemJudgeConfig,
  resolveJudgeDataPath,
} from "./problem-judge-config";

test("communication is independent and auto-detected before interactor/checker", () => {
  assert.equal(isProblemType("communication"), true);
  const { type, config } = normalizeProblemJudgeConfig({}, {
    currentType: "default",
    files: ["communicator.cpp", "interactor.cpp", "checker.cpp", "10.in", "2.in", "2.ans"],
    autoDetect: true,
  });
  assert.equal(type, "communication");
  assert.equal(config.type, type);
  assert.equal(config.communicator, "communicator.cpp");
  assert.equal(config.interactor, undefined);
  assert.equal(config.checker, undefined);
  assert.deepEqual(config.communication, { output_limit: DEFAULT_COMMUNICATION_OUTPUT_LIMIT });
  assert.deepEqual(config.cases, [
    { input: "2.in", output: "2.ans" },
    { input: "10.in", output: "/dev/null" },
  ]);
});

test("explicit YAML type wins over programs left in the data directory", () => {
  for (const type of ["default", "spj", "interactive", "communication"]) {
    const result = normalizeProblemJudgeConfig({ type }, {
      currentType: "communication",
      files: ["communicator.cpp", "interactor.cpp", "checker.cpp", "1.in"],
      autoDetect: true,
    });
    assert.equal(result.type, type);
  }
});

test("YAML communication configuration preserves handwritten cases and limits", () => {
  const parsed = yaml.load(`type: communication
communicator: codec.cpp
communication:
  output_limit: 64
time_limit_rate:
  pypy3: 2
cases:
  - input: b.in
    output: answer.txt
  - input: a.in
`);
  const { config } = normalizeProblemJudgeConfig(parsed, {
    currentType: "default",
    files: ["codec.cpp", "a.in", "b.in", "answer.txt", "unlisted.in"],
    autoDetect: true,
  });
  assert.deepEqual(config.cases, [
    { input: "b.in", output: "answer.txt" },
    { input: "a.in", output: "/dev/null" },
  ]);
  assert.deepEqual(config.time_limit_rate, { pypy3: 2 });
  assert.equal(config.communicator, "codec.cpp");
  assert.deepEqual(config.communication, { output_limit: 64 });
});

test("communication output limits default and enforce exact byte boundaries", () => {
  assert.equal(getCommunicationOutputLimit(undefined), DEFAULT_COMMUNICATION_OUTPUT_LIMIT);
  assert.equal(getCommunicationOutputLimit({}), DEFAULT_COMMUNICATION_OUTPUT_LIMIT);
  assert.equal(getCommunicationOutputLimit({ output_limit: 1 }), 1);
  assert.equal(getCommunicationOutputLimit({ output_limit: MAX_COMMUNICATION_OUTPUT_LIMIT }), MAX_COMMUNICATION_OUTPUT_LIMIT);
  for (const output_limit of [null, 0, -1, 1.5, "10", true, Infinity, NaN,
    MAX_COMMUNICATION_OUTPUT_LIMIT + 1]) {
    assert.throws(() => getCommunicationOutputLimit({ output_limit }), /output_limit must be an integer/);
  }
  for (const invalid of [null, [], "64", 64]) {
    assert.throws(() => getCommunicationOutputLimit(invalid), /YAML mapping/);
  }
});

test("requires communicator and never silently downgrades a communication problem", () => {
  assert.throws(() => normalizeProblemJudgeConfig({}, {
    currentType: "communication", files: ["interactor.cpp", "checker.cpp", "1.in"], autoDetect: true,
  }), /require an existing communicator/);
  assert.throws(() => normalizeProblemJudgeConfig({
    type: "communication", communicator: "missing.cpp", cases: [{ input: "1.in" }],
  }, { currentType: "default", files: ["1.in"] }), /Communicator file not found/);
  assert.throws(() => normalizeProblemJudgeConfig({ type: "communication" }, {
    currentType: "default", files: ["1.in"], autoDetect: true,
  }), /require an existing communicator/);
});

test("rejects empty or malformed configurations without accepting a judge-ready package", () => {
  for (const config of [undefined, null, {}, { cases: [] }]) {
    assert.throws(() => normalizeProblemJudgeConfig(config, {
      currentType: "default", files: [], autoDetect: true,
    }), /at least one test case/);
  }
  for (const config of ["not a mapping", [], new Date()]) {
    assert.throws(() => normalizeProblemJudgeConfig(config, {
      currentType: "default", files: [],
    }), /YAML mapping/);
  }
  assert.throws(() => normalizeProblemJudgeConfig({ type: "unknown" }, {
    currentType: "default", files: ["1.in"], autoDetect: true,
  }), /Problem type/);
  assert.throws(() => normalizeProblemJudgeConfig({ cases: [{ output: "1.out" }] }, {
    currentType: "default", files: ["1.out"],
  }), /Test case 1 input/);
});

test("keeps explicit missing cases as errors instead of overwriting the author's case selection", () => {
  assert.throws(() => normalizeProblemJudgeConfig({
    cases: [{ input: "missing.in", output: "/dev/null" }],
  }, { currentType: "default", files: ["1.in"], autoDetect: true }), /input file not found/);
  assert.throws(() => normalizeProblemJudgeConfig({
    cases: [{ input: "1.in", output: "missing.out" }],
  }, { currentType: "default", files: ["1.in"], autoDetect: true }), /output file not found/);
});

test("retains standard, SPJ and interactive configurations", () => {
  assert.equal(normalizeProblemJudgeConfig({
    cases: [{ input: "/dev/null", output: "/dev/null" }],
  }, { currentType: "default", files: [] }).type, "default");
  assert.equal(normalizeProblemJudgeConfig({}, {
    currentType: "default", files: ["checker.cpp", "1.in", "1.out"], autoDetect: true,
  }).type, "spj");
  assert.equal(normalizeProblemJudgeConfig({}, {
    currentType: "default", files: ["interactor.cpp", "1.in"], autoDetect: true,
  }).type, "interactive");
  assert.throws(() => normalizeProblemJudgeConfig({}, {
    currentType: "interactive", files: ["checker.cpp", "1.in"], autoDetect: true,
  }), /require an existing interactor/);
});

test("data path resolution blocks traversal and Windows path aliases", () => {
  const root = path.resolve("uploads/problems/1/data");
  const unsafeNames = ["../secret", "sub/../../secret", "..\\secret", "/etc/passwd",
    "C:\\secret", "C:secret", "\\\\server\\share", "file:stream", "/dev/null",
    ".. /secret", "nul", "file\0.cpp"];
  for (const name of unsafeNames) {
    assert.throws(() => resolveJudgeDataPath(root, name));
    assert.throws(() => normalizeProblemJudgeConfig({
      type: "communication", communicator: name, cases: [{ input: "1.in" }],
    }, { currentType: "communication", files: ["1.in"] }));
  }
  assert.equal(resolveJudgeDataPath(root, "nested/input.in"), path.join(root, "nested/input.in"));
  assert.equal(resolveJudgeDataPath(root, "./nested/input.in"), path.join(root, "nested/input.in"));
});

test("valid nested relative references normalize portably without modifying case data", () => {
  const { config } = normalizeProblemJudgeConfig({
    type: "communication", communicator: "tools\\codec.cpp",
    cases: [{ input: "first\\secret.in", output: "answers/secret.ans" }],
  }, {
    currentType: "default", files: ["tools/codec.cpp", "first/secret.in", "answers/secret.ans"],
  });
  assert.equal(config.communicator, "tools/codec.cpp");
  assert.deepEqual(config.cases, [{ input: "first/secret.in", output: "answers/secret.ans" }]);
});
