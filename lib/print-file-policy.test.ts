import assert from "node:assert/strict";
import test from "node:test";
import { PRINT_FILE_MAX_BYTES, PRINT_FILE_MAX_CHARACTERS, PRINT_FILE_MAX_JSON_BYTES, readPrintFileJson, validatePrintFile } from "./print-file-policy";

test("print language comes exclusively from the six allowed filename extensions", () => {
  for (const [extension, language] of [["c", "c"], ["cpp", "cpp"], ["cc", "cpp"], ["cxx", "cpp"], ["java", "java"], ["py", "pypy3"]]) {
    for (const suffix of [extension, extension.toUpperCase()]) {
      assert.equal(validatePrintFile({ sourceFilename: `解答.${suffix}`, code: "source", language: "html" }).language, language);
    }
  }
  for (const sourceFilename of ["answer.txt", "answer", "answer.cpp.exe", "answer.cpp ", "answer.js", "answer.pdf"]) {
    assert.throws(() => validatePrintFile({ sourceFilename, code: "source" }), { status: 400, code: "INVALID_PRINT_EXTENSION" });
  }
});

test("print filenames must be bounded basenames without path or control characters", () => {
  for (const sourceFilename of ["", null, 42, "../answer.cpp", "dir/answer.cpp", "dir\\answer.cpp", "C:answer.cpp", "C:\\answer.cpp", "answer\n.cpp", "answer\x00.cpp", "answer\x7f.cpp", "answer\x85.cpp", `${"a".repeat(252)}.cpp`]) {
    assert.throws(() => validatePrintFile({ sourceFilename, code: "source" }), { status: 400, code: "INVALID_PRINT_FILENAME" });
  }
  const sourceFilename = `${"a".repeat(251)}.cpp`;
  assert.equal(validatePrintFile({ sourceFilename, code: "source" }).sourceFilename, sourceFilename);
});

test("print content preserves source and whitespace but rejects binary and blank content", () => {
  const code = "\tprint('测试')\r\n\n";
  assert.equal(validatePrintFile({ sourceFilename: "test.py", code }).code, code);
  for (const invalid of [undefined, 42, "", " \t\r\n", "a\0b", "a\x01b", "a\x0bb", "a\x0cb", "a\x1bb", "a\x7fb", "a\x85b"]) {
    assert.throws(() => validatePrintFile({ sourceFilename: "test.py", code: invalid }), { status: 400, code: "INVALID_PRINT_CONTENT" });
  }
});

test("print content enforces both UTF-8 bytes and database character limits", () => {
  assert.equal(validatePrintFile({ sourceFilename: "test.py", code: "a".repeat(PRINT_FILE_MAX_CHARACTERS) }).code.length, PRINT_FILE_MAX_CHARACTERS);
  assert.equal(validatePrintFile({ sourceFilename: "test.py", code: "中".repeat(PRINT_FILE_MAX_BYTES / 3) }).code.length, 40_000);
  for (const code of ["a".repeat(PRINT_FILE_MAX_CHARACTERS + 1), "中".repeat(40_001), "🙂".repeat(30_001)]) {
    assert.throws(() => validatePrintFile({ sourceFilename: "test.py", code }), { status: 413, code: "PRINT_FILE_TOO_LARGE" });
  }
});

const jsonRequest = (body: string | Uint8Array, headers: Record<string, string> = {}) => new Request("https://judge.test/api/cli/device/print", {
  method: "POST", headers: { "content-type": "application/json; charset=utf-8", ...headers }, body: body as BodyInit,
});

test("bounded JSON reader accepts escaped maximum-sized source", async () => {
  const body = `{"sourceFilename":"test.py","code":"${"\\u0061".repeat(PRINT_FILE_MAX_CHARACTERS)}"}`;
  const parsed = await readPrintFileJson(jsonRequest(body));
  assert.equal(validatePrintFile(parsed).code.length, PRINT_FILE_MAX_CHARACTERS);
});

test("bounded JSON reader rejects malformed JSON, non-object JSON and non-UTF-8 input", async () => {
  for (const body of ["", "{", "null", "[]", "42", '"source"', new Uint8Array([0xff, 0xfe])]) {
    await assert.rejects(readPrintFileJson(jsonRequest(body)), { status: 400, code: "INVALID_JSON" });
  }
  await assert.rejects(readPrintFileJson(jsonRequest("{}", { "content-type": "text/plain" })), { status: 415, code: "INVALID_CONTENT_TYPE" });
});

test("bounded JSON reader checks advertised and actual sizes even with misleading or absent lengths", async () => {
  await assert.rejects(readPrintFileJson(jsonRequest("{}", { "content-length": String(PRINT_FILE_MAX_JSON_BYTES + 1) })), { status: 413, code: "PRINT_FILE_TOO_LARGE" });
  for (const headers of [{}, { "content-length": "2" }] as Record<string, string>[]) {
    await assert.rejects(readPrintFileJson(jsonRequest(" ".repeat(PRINT_FILE_MAX_JSON_BYTES + 1), headers)), { status: 413, code: "PRINT_FILE_TOO_LARGE" });
  }
});

test("JSON escapes cannot smuggle unpaired surrogates into filenames or source", async () => {
  for (const escape of ["\\ud800", "\\udfff", "\\ud800\\ud800", "\\udfff\\udfff"]) {
    const source = await readPrintFileJson(jsonRequest(`{"sourceFilename":"test.py","code":"${escape}"}`));
    assert.throws(() => validatePrintFile(source), { code: "INVALID_PRINT_CONTENT" });
    const filename = await readPrintFileJson(jsonRequest(`{"sourceFilename":"${escape}.py","code":"source"}`));
    assert.throws(() => validatePrintFile(filename), { code: "INVALID_PRINT_FILENAME" });
  }
  assert.equal(validatePrintFile({ sourceFilename: "🙂.py", code: "print('🙂')" }).code, "print('🙂')");
});

test("bounded JSON reader stops and cancels an oversized chunked stream", async () => {
  let cancelled = false;
  let chunks = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { chunks++; controller.enqueue(new Uint8Array(65_536).fill(32)); },
    cancel() { cancelled = true; },
  });
  const request = new Request("https://judge.test/api/cli/device/print", {
    method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half",
  } as RequestInit);
  await assert.rejects(readPrintFileJson(request), { status: 413, code: "PRINT_FILE_TOO_LARGE" });
  assert.equal(cancelled, true);
  assert.ok(chunks <= PRINT_FILE_MAX_JSON_BYTES / 65_536 + 2);
});
