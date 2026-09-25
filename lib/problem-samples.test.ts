import assert from "node:assert/strict";
import test from "node:test";
import {
  createCommunicationSample,
  getCommunicationSampleDisplay,
  getPublicProblemSamples,
  normalizeProblemSamples,
  type ProblemSample,
} from "./problem-samples";

const sample: ProblemSample = {
  input: "first\n5\n1 2 3 4 5\n",
  output: "private-reference-answer\n",
  communication: {
    firstOutput: "abcde\n",
    secondInput: "second\nabcde\n",
    secondOutput: "5\n1 2 3 4 5\n",
  },
};

test("paired samples survive JSON save/export/import without losing whitespace or reference answers", () => {
  assert.deepEqual(normalizeProblemSamples(JSON.parse(JSON.stringify([sample]))), [sample]);
});

test("legacy communication samples keep their reference answer out of the displayed output", () => {
  const legacy = { input: "first\nsecret\n", output: "private-reference-answer\n" };
  assert.deepEqual(normalizeProblemSamples([legacy]), [legacy]);
  assert.deepEqual(getCommunicationSampleDisplay(legacy), {
    firstInput: legacy.input, firstOutput: "", secondInput: "", secondOutput: "",
  });
  assert.deepEqual(getPublicProblemSamples("communication", [legacy]), [{ input: legacy.input, output: "" }]);
});

test("public statement and companion data use illustrative messages and never the judge reference", () => {
  assert.deepEqual(getCommunicationSampleDisplay(sample), {
    firstInput: sample.input, ...sample.communication,
  });
  const publicSamples = getPublicProblemSamples("communication", [sample]);
  assert.deepEqual(publicSamples, [
    { input: sample.input, output: "abcde\n" },
    { input: "second\nabcde\n", output: "5\n1 2 3 4 5\n" },
  ]);
  assert.ok(!JSON.stringify(publicSamples).includes("private-reference-answer"));
});

test("standard, SPJ and interactive samples preserve their original public input/output", () => {
  const ordinary = [{ input: "1 2\n", output: "3\n" }];
  assert.deepEqual(normalizeProblemSamples(ordinary), ordinary);
  for (const type of ["default", "spj", "interactive"]) {
    assert.deepEqual(getPublicProblemSamples(type, ordinary), ordinary);
  }
});

test("run markers and transformations belong to the author, not sample normalization", () => {
  const custom = { ...sample, input: "encode\n1 2\n", communication: {
    firstOutput: "2 1\n", secondInput: "decode\n1 2\n", secondOutput: "ok\n",
  } };
  assert.deepEqual(normalizeProblemSamples([custom]), [custom]);
});

test("malformed paired data is rejected before it reaches the editor or statement", () => {
  for (const value of [null, {}, [null], [{ input: 1, output: "" }],
    [{ ...sample, communication: null }], [{ ...sample, communication: [] }],
    [{ ...sample, communication: { ...sample.communication, secondInput: 123 } }],
    [{ ...sample, communication: { firstOutput: "x", secondInput: "second\nx" } }],
  ]) {
    assert.throws(() => normalizeProblemSamples(value), /Samples|Sample/);
  }
  assert.deepEqual(normalizeProblemSamples([createCommunicationSample()]), [createCommunicationSample()]);
});
